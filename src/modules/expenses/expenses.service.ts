import { Decimal } from 'decimal.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { ConflictError, NotFoundError, ValidationError } from '../../shared/errors/errors.js';
import { ErrorCode } from '../../shared/errors/codes.js';
import { roundToCurrency } from '../../domain/money/money.js';
import {
  splitEqual,
  splitExact,
  splitPercentage,
  splitShares,
  SplitMismatchError,
  PercentageMismatchError,
} from '../../domain/splitting/split.js';
import type { SplitResult } from '../../domain/splitting/split.js';
import { parsePagination, buildPage } from '../../shared/utils/pagination.js';
import type { Page } from '../../shared/utils/pagination.js';
import { EXPENSE_INCLUDE, toExpenseDto } from './expenses.mapper.js';
import type { ExpenseDto } from './expenses.mapper.js';
import type {
  CreateExpenseDto,
  UpdateExpenseDto,
  ListExpensesQuery,
  ParticipantInput,
} from './expenses.schema.js';
import type { Prisma, SplitType } from '../../generated/prisma/client.js';
import { assertValidCategory } from '../categories/categories.service.js';
import { lockHouseholdShared } from '../households/households.service.js';

/** Dispatches to the right domain split strategy. Reused by recurring-expenses when materializing an occurrence. */
export const computeSplits = (
  splitType: SplitType,
  amount: string,
  participants: ParticipantInput[],
  decimalPlaces: number,
): SplitResult[] => {
  try {
    switch (splitType) {
      case 'equal':
        return splitEqual(
          amount,
          participants.map((p) => p.userId),
          decimalPlaces,
        );
      case 'exact':
        return splitExact(
          amount,
          participants.map((p) => {
            if (p.amount === undefined) {
              throw new ValidationError(
                'Exact split requires an amount for every participant',
                ErrorCode.INVALID_EXPENSE_SPLIT,
              );
            }
            return { userId: p.userId, amount: p.amount };
          }),
          decimalPlaces,
        );
      case 'percentage':
        return splitPercentage(
          amount,
          participants.map((p) => {
            if (p.percentage === undefined) {
              throw new ValidationError(
                'Percentage split requires a percentage for every participant',
                ErrorCode.INVALID_EXPENSE_SPLIT,
              );
            }
            return { userId: p.userId, percentage: p.percentage };
          }),
          decimalPlaces,
        );
      case 'shares':
        return splitShares(
          amount,
          participants.map((p) => {
            if (p.shares === undefined) {
              throw new ValidationError(
                'Shares split requires a share count for every participant',
                ErrorCode.INVALID_EXPENSE_SPLIT,
              );
            }
            return { userId: p.userId, shares: p.shares };
          }),
          decimalPlaces,
        );
    }
  } catch (error) {
    if (error instanceof SplitMismatchError) {
      throw new ValidationError(
        'Participants do not sum to the expense total',
        ErrorCode.INVALID_EXPENSE_SPLIT,
        {
          expected: error.expected.toFixed(decimalPlaces),
          received: error.received.toFixed(decimalPlaces),
        },
      );
    }
    if (error instanceof PercentageMismatchError) {
      throw new ValidationError('Percentages must sum to 100', ErrorCode.INVALID_EXPENSE_SPLIT, {
        received: error.received.toFixed(2),
      });
    }
    throw error;
  }
};

export const splitsToRows = (splits: SplitResult[], decimalPlaces: number) =>
  splits.map((s) => ({
    userId: s.userId,
    amount: s.amount.toFixed(decimalPlaces),
    percentage: s.percentage?.toFixed(2) ?? null,
    shares: s.shares ?? null,
  }));

export const getExpense = async (householdId: string, expenseId: string): Promise<ExpenseDto> => {
  const expense = await prisma.expense.findFirst({
    where: { id: expenseId, householdId },
    include: EXPENSE_INCLUDE,
  });
  if (!expense) {
    throw new NotFoundError('Expense not found');
  }
  return toExpenseDto(expense);
};

/** The household with its currency, in one query: both are needed to validate any amount. */
const loadHouseholdWithCurrency = async (
  householdId: string,
  db: Prisma.TransactionClient = prisma,
) => {
  const household = await db.household.findFirst({
    where: { id: householdId, deletedAt: null },
    include: { defaultCurrency: true },
  });
  if (!household) {
    throw new NotFoundError('Household not found', ErrorCode.HOUSEHOLD_NOT_FOUND);
  }
  return household;
};

/**
 * Checks the payer and every participant are active members with a single
 * query. The payer is reported first so the error code matches what separate
 * checks would have produced. `ErrorClass` picks the HTTP shape: a bad request
 * body is a 422, a stored expense whose people left since is a 409.
 */
const assertActiveParties = async (
  db: Prisma.TransactionClient,
  householdId: string,
  parties: { payerId?: string; participantIds?: string[] },
  ErrorClass: typeof ValidationError | typeof ConflictError,
): Promise<void> => {
  const wanted = new Set([
    ...(parties.payerId ? [parties.payerId] : []),
    ...(parties.participantIds ?? []),
  ]);
  if (wanted.size === 0) {
    return;
  }
  const active = await db.householdMember.findMany({
    where: { householdId, userId: { in: [...wanted] }, leftAt: null },
    select: { userId: true },
  });
  const activeIds = new Set(active.map((member) => member.userId));
  const message = 'All specified users must be active members of this household';

  if (parties.payerId && !activeIds.has(parties.payerId)) {
    throw new ErrorClass(message, ErrorCode.INVALID_PAYER);
  }
  if ((parties.participantIds ?? []).some((userId) => !activeIds.has(userId))) {
    throw new ErrorClass(message, ErrorCode.INVALID_PARTICIPANT);
  }
};

export const createExpense = async (
  userId: string,
  householdId: string,
  dto: CreateExpenseDto,
): Promise<ExpenseDto> => {
  // One transaction from the lock to the insert, so the payer, participants and
  // currency checked here are still the household's when the expense lands.
  const created = await prisma.$transaction(async (tx) => {
    await lockHouseholdShared(tx, householdId);

    const household = await loadHouseholdWithCurrency(householdId, tx);
    if (dto.currencyCode !== household.defaultCurrencyCode) {
      throw new ValidationError(
        `Currency must match the household's currency (${household.defaultCurrencyCode})`,
        ErrorCode.INVALID_CURRENCY,
      );
    }

    const currency = household.defaultCurrency;
    const amount = roundToCurrency(dto.amount, currency.decimalPlaces);
    if (amount.lte(0)) {
      throw new ValidationError('Amount must be greater than zero');
    }

    await assertActiveParties(
      tx,
      householdId,
      { payerId: dto.paidBy, participantIds: dto.participants.map((p) => p.userId) },
      ValidationError,
    );
    if (dto.categoryId) {
      await assertValidCategory(householdId, dto.categoryId, tx);
    }

    const splits = computeSplits(
      dto.splitType,
      amount.toFixed(currency.decimalPlaces),
      dto.participants,
      currency.decimalPlaces,
    );

    // One nested create instead of create + createMany + re-read: the expense
    // and its splits persist together and come back as the finished row.
    return tx.expense.create({
      data: {
        householdId,
        categoryId: dto.categoryId ?? null,
        paidBy: dto.paidBy,
        description: dto.description,
        notes: dto.notes ?? null,
        amount: amount.toFixed(currency.decimalPlaces),
        currencyCode: dto.currencyCode,
        splitType: dto.splitType,
        expenseDate: new Date(dto.expenseDate),
        createdBy: userId,
        splits: { createMany: { data: splitsToRows(splits, currency.decimalPlaces) } },
      },
      include: EXPENSE_INCLUDE,
    });
  });
  return toExpenseDto(created);
};

const expenseAlreadyVoided = () =>
  new ConflictError('Expense was already voided', ErrorCode.EXPENSE_ALREADY_VOIDED);

const expenseNotPending = () =>
  new ConflictError(
    'Only a pending recurring occurrence can be confirmed or skipped',
    ErrorCode.RECURRING_OCCURRENCE_NOT_PENDING,
  );

/**
 * A conditional status update matched no row. Re-reads to say why, so losing a
 * race gives the same answer as the sequential case: 404 when the expense is
 * not in this household, otherwise the conflict for the state it is now in.
 */
const rejectUnmatchedTransition = async (
  db: Prisma.TransactionClient,
  householdId: string,
  expenseId: string,
  conflict: ConflictError,
): Promise<never> => {
  const exists = await db.expense.count({ where: { id: expenseId, householdId } });
  if (exists === 0) {
    throw new NotFoundError('Expense not found');
  }
  throw conflict;
};

const loadActiveExpense = async (householdId: string, expenseId: string) => {
  const expense = await prisma.expense.findFirst({ where: { id: expenseId, householdId } });
  if (!expense) {
    throw new NotFoundError('Expense not found');
  }
  if (expense.status === 'voided') {
    throw expenseAlreadyVoided();
  }
  return expense;
};

export const updateExpense = async (
  householdId: string,
  expenseId: string,
  dto: UpdateExpenseDto,
): Promise<ExpenseDto> => {
  // Read up front so a missing or voided expense is reported before the body
  // is judged; the write below re-checks the status atomically.
  await loadActiveExpense(householdId, expenseId);

  return prisma.$transaction(async (tx) => {
    // The people and currency judged below must still hold when the edit lands.
    await lockHouseholdShared(tx, householdId);

    await assertActiveParties(
      tx,
      householdId,
      { payerId: dto.paidBy, participantIds: dto.participants?.map((p) => p.userId) },
      ValidationError,
    );
    if (dto.categoryId) {
      await assertValidCategory(householdId, dto.categoryId, tx);
    }

    let splitUpdate: {
      amount: Decimal;
      splitType: SplitType;
      splits: SplitResult[];
      decimalPlaces: number;
    } | null = null;
    if (dto.amount !== undefined && dto.splitType !== undefined && dto.participants !== undefined) {
      const { defaultCurrency: currency } = await loadHouseholdWithCurrency(householdId, tx);
      const amount = roundToCurrency(dto.amount, currency.decimalPlaces);
      if (amount.lte(0)) {
        throw new ValidationError('Amount must be greater than zero');
      }
      const splits = computeSplits(
        dto.splitType,
        amount.toFixed(currency.decimalPlaces),
        dto.participants,
        currency.decimalPlaces,
      );
      splitUpdate = {
        amount,
        splitType: dto.splitType,
        splits,
        decimalPlaces: currency.decimalPlaces,
      };
    }

    // The conditional update comes first: it takes the row lock, so a
    // concurrent void or edit waits here and then sees the committed state.
    // Replacing the splits only after that guard also keeps two racing edits
    // from interleaving their delete and insert.
    const updated = await tx.expense.updateMany({
      where: { id: expenseId, householdId, status: { not: 'voided' } },
      data: {
        description: dto.description,
        notes: dto.notes,
        expenseDate: dto.expenseDate ? new Date(dto.expenseDate) : undefined,
        categoryId: dto.categoryId,
        paidBy: dto.paidBy,
        ...(splitUpdate
          ? {
              amount: splitUpdate.amount.toFixed(splitUpdate.decimalPlaces),
              splitType: splitUpdate.splitType,
            }
          : {}),
      },
    });
    if (updated.count === 0) {
      await rejectUnmatchedTransition(tx, householdId, expenseId, expenseAlreadyVoided());
    }

    if (splitUpdate) {
      await tx.expenseSplit.deleteMany({ where: { expenseId } });
      await tx.expenseSplit.createMany({
        data: splitsToRows(splitUpdate.splits, splitUpdate.decimalPlaces).map((row) => ({
          ...row,
          expenseId,
        })),
      });
    }

    const expense = await tx.expense.findUniqueOrThrow({
      where: { id: expenseId },
      include: EXPENSE_INCLUDE,
    });
    return toExpenseDto(expense);
  });
};

export const voidExpense = async (householdId: string, expenseId: string): Promise<void> => {
  const voided = await prisma.expense.updateMany({
    where: { id: expenseId, householdId, status: { not: 'voided' } },
    data: { status: 'voided', voidedAt: new Date() },
  });
  if (voided.count === 0) {
    await rejectUnmatchedTransition(prisma, householdId, expenseId, expenseAlreadyVoided());
  }
};

/** A pending recurring occurrence becomes a normal active expense — it now counts toward balances. */
export const confirmExpense = async (
  householdId: string,
  expenseId: string,
): Promise<ExpenseDto> => {
  await prisma.$transaction(async (tx) => {
    // Before the status flip: the membership check below must see any leave
    // that was already holding the household lock.
    await lockHouseholdShared(tx, householdId);

    const confirmed = await tx.expense.updateMany({
      where: { id: expenseId, householdId, status: 'pending' },
      data: { status: 'active' },
    });
    if (confirmed.count === 0) {
      await rejectUnmatchedTransition(tx, householdId, expenseId, expenseNotPending());
    }

    // An occurrence can sit pending for days; people may have left the
    // household since it was generated, and an active expense must not charge
    // or credit someone who is no longer a member. Throwing rolls the
    // confirmation back, leaving it pending (it can still be skipped).
    const expense = await tx.expense.findUniqueOrThrow({
      where: { id: expenseId },
      select: { paidBy: true, splits: { select: { userId: true } } },
    });
    await assertActiveParties(
      tx,
      householdId,
      { payerId: expense.paidBy, participantIds: expense.splits.map((split) => split.userId) },
      ConflictError,
    );
  });
  return getExpense(householdId, expenseId);
};

/** A pending recurring occurrence is voided instead — it never counts toward balances. */
export const skipExpense = async (householdId: string, expenseId: string): Promise<void> => {
  const skipped = await prisma.expense.updateMany({
    where: { id: expenseId, householdId, status: 'pending' },
    data: { status: 'voided', voidedAt: new Date() },
  });
  if (skipped.count === 0) {
    await rejectUnmatchedTransition(prisma, householdId, expenseId, expenseNotPending());
  }
};

export const listExpenses = async (
  householdId: string,
  query: ListExpensesQuery,
): Promise<Page<ExpenseDto>> => {
  const { take, cursor } = parsePagination(query);

  const where: Prisma.ExpenseWhereInput = {
    householdId,
    // An explicit `status` wins; otherwise voided rows are hidden unless asked for.
    status: query.status ?? (query.includeVoided === 'true' ? undefined : { not: 'voided' }),
    ...(query.categoryId ? { categoryId: query.categoryId } : {}),
    ...(query.paidBy ? { paidBy: query.paidBy } : {}),
    ...(query.participantId ? { splits: { some: { userId: query.participantId } } } : {}),
    ...(query.from || query.to
      ? {
          expenseDate: {
            ...(query.from ? { gte: new Date(query.from) } : {}),
            ...(query.to ? { lte: new Date(query.to) } : {}),
          },
        }
      : {}),
  };

  const rows = await prisma.expense.findMany({
    where,
    include: EXPENSE_INCLUDE,
    orderBy: [{ expenseDate: 'desc' }, { id: 'desc' }],
    take: take + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const page = buildPage(rows, take);
  return { data: page.data.map(toExpenseDto), nextCursor: page.nextCursor };
};
