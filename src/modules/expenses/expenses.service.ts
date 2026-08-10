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
import { assertHouseholdActive, assertActiveMembers } from '../households/households.service.js';
import { assertValidCategory } from '../categories/categories.service.js';

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

export const createExpense = async (
  userId: string,
  householdId: string,
  dto: CreateExpenseDto,
): Promise<ExpenseDto> => {
  const household = await assertHouseholdActive(householdId);
  if (dto.currencyCode !== household.defaultCurrencyCode) {
    throw new ValidationError(
      `Currency must match the household's currency (${household.defaultCurrencyCode})`,
      ErrorCode.INVALID_CURRENCY,
    );
  }

  const currency = await prisma.currency.findUniqueOrThrow({ where: { code: dto.currencyCode } });
  const amount = roundToCurrency(dto.amount, currency.decimalPlaces);
  if (amount.lte(0)) {
    throw new ValidationError('Amount must be greater than zero');
  }

  await assertActiveMembers(householdId, [dto.paidBy], ErrorCode.INVALID_PAYER);
  await assertActiveMembers(
    householdId,
    dto.participants.map((p) => p.userId),
    ErrorCode.INVALID_PARTICIPANT,
  );
  if (dto.categoryId) {
    await assertValidCategory(householdId, dto.categoryId);
  }

  const splits = computeSplits(
    dto.splitType,
    amount.toFixed(currency.decimalPlaces),
    dto.participants,
    currency.decimalPlaces,
  );

  const created = await prisma.$transaction(async (tx) => {
    const expense = await tx.expense.create({
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
      },
    });
    await tx.expenseSplit.createMany({
      data: splitsToRows(splits, currency.decimalPlaces).map((row) => ({
        ...row,
        expenseId: expense.id,
      })),
    });
    return expense;
  });

  return getExpense(householdId, created.id);
};

const loadActiveExpense = async (householdId: string, expenseId: string) => {
  const expense = await prisma.expense.findFirst({ where: { id: expenseId, householdId } });
  if (!expense) {
    throw new NotFoundError('Expense not found');
  }
  if (expense.status === 'voided') {
    throw new ConflictError('Expense was already voided', ErrorCode.EXPENSE_ALREADY_VOIDED);
  }
  return expense;
};

export const updateExpense = async (
  householdId: string,
  expenseId: string,
  dto: UpdateExpenseDto,
): Promise<ExpenseDto> => {
  await loadActiveExpense(householdId, expenseId);
  const household = await assertHouseholdActive(householdId);

  if (dto.paidBy) {
    await assertActiveMembers(householdId, [dto.paidBy], ErrorCode.INVALID_PAYER);
  }
  if (dto.categoryId) {
    await assertValidCategory(householdId, dto.categoryId);
  }

  let splitUpdate: {
    amount: Decimal;
    splitType: SplitType;
    splits: SplitResult[];
    decimalPlaces: number;
  } | null = null;
  if (dto.amount !== undefined && dto.splitType !== undefined && dto.participants !== undefined) {
    const currency = await prisma.currency.findUniqueOrThrow({
      where: { code: household.defaultCurrencyCode },
    });
    const amount = roundToCurrency(dto.amount, currency.decimalPlaces);
    if (amount.lte(0)) {
      throw new ValidationError('Amount must be greater than zero');
    }
    await assertActiveMembers(
      householdId,
      dto.participants.map((p) => p.userId),
      ErrorCode.INVALID_PARTICIPANT,
    );
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

  await prisma.$transaction(async (tx) => {
    await tx.expense.update({
      where: { id: expenseId },
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

    if (splitUpdate) {
      await tx.expenseSplit.deleteMany({ where: { expenseId } });
      await tx.expenseSplit.createMany({
        data: splitsToRows(splitUpdate.splits, splitUpdate.decimalPlaces).map((row) => ({
          ...row,
          expenseId,
        })),
      });
    }
  });

  return getExpense(householdId, expenseId);
};

export const voidExpense = async (householdId: string, expenseId: string): Promise<void> => {
  await loadActiveExpense(householdId, expenseId);
  await prisma.expense.update({
    where: { id: expenseId },
    data: { status: 'voided', voidedAt: new Date() },
  });
};

const loadPendingExpense = async (householdId: string, expenseId: string) => {
  const expense = await prisma.expense.findFirst({ where: { id: expenseId, householdId } });
  if (!expense) {
    throw new NotFoundError('Expense not found');
  }
  if (expense.status !== 'pending') {
    throw new ConflictError(
      'Only a pending recurring occurrence can be confirmed or skipped',
      ErrorCode.RECURRING_OCCURRENCE_NOT_PENDING,
    );
  }
  return expense;
};

/** A pending recurring occurrence becomes a normal active expense — it now counts toward balances. */
export const confirmExpense = async (
  householdId: string,
  expenseId: string,
): Promise<ExpenseDto> => {
  await loadPendingExpense(householdId, expenseId);
  await prisma.expense.update({ where: { id: expenseId }, data: { status: 'active' } });
  return getExpense(householdId, expenseId);
};

/** A pending recurring occurrence is voided instead — it never counts toward balances. */
export const skipExpense = async (householdId: string, expenseId: string): Promise<void> => {
  await loadPendingExpense(householdId, expenseId);
  await prisma.expense.update({
    where: { id: expenseId },
    data: { status: 'voided', voidedAt: new Date() },
  });
};

export const listExpenses = async (
  householdId: string,
  query: ListExpensesQuery,
): Promise<Page<ExpenseDto>> => {
  const { take, cursor } = parsePagination(query);

  const where: Prisma.ExpenseWhereInput = {
    householdId,
    status: query.status ?? { not: 'voided' },
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
