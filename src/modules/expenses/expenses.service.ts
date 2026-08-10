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

const loadActiveHousehold = async (householdId: string) => {
  const household = await prisma.household.findFirst({
    where: { id: householdId, deletedAt: null },
  });
  if (!household) {
    throw new NotFoundError('Household not found', ErrorCode.HOUSEHOLD_NOT_FOUND);
  }
  return household;
};

const assertActiveMember = async (
  householdId: string,
  userId: string,
  code: ErrorCode,
): Promise<void> => {
  const membership = await prisma.householdMember.findFirst({
    where: { householdId, userId, leftAt: null },
  });
  if (!membership) {
    throw new ValidationError(`User ${userId} is not an active member of this household`, code);
  }
};

const assertActiveMembers = async (
  householdId: string,
  userIds: string[],
  code: ErrorCode,
): Promise<void> => {
  const uniqueIds = [...new Set(userIds)];
  const count = await prisma.householdMember.count({
    where: { householdId, userId: { in: uniqueIds }, leftAt: null },
  });
  if (count !== uniqueIds.length) {
    throw new ValidationError('All participants must be active members of this household', code);
  }
};

const assertValidCategory = async (householdId: string, categoryId: string): Promise<void> => {
  const category = await prisma.category.findFirst({
    where: { id: categoryId, deletedAt: null, OR: [{ isSystem: true }, { householdId }] },
  });
  if (!category) {
    throw new ValidationError(
      'Category must be global or belong to this household',
      ErrorCode.INVALID_CATEGORY,
    );
  }
};

const computeSplits = (
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

const splitsToRows = (splits: SplitResult[], decimalPlaces: number) =>
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
  const household = await loadActiveHousehold(householdId);
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

  await assertActiveMember(householdId, dto.paidBy, ErrorCode.INVALID_PAYER);
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
  const household = await loadActiveHousehold(householdId);

  if (dto.paidBy) {
    await assertActiveMember(householdId, dto.paidBy, ErrorCode.INVALID_PAYER);
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
