import { prisma } from '../../infrastructure/database/prisma.js';
import { logger } from '../../infrastructure/logging/logger.js';
import { NotFoundError, ValidationError } from '../../shared/errors/errors.js';
import { ErrorCode } from '../../shared/errors/codes.js';
import { roundToCurrency } from '../../domain/money/money.js';
import { advanceDate, dueDates } from '../../domain/recurrence/schedule.js';
import { assertHouseholdActive, assertActiveMembers } from '../households/households.service.js';
import { assertValidCategory } from '../categories/categories.service.js';
import { computeSplits, splitsToRows } from '../expenses/expenses.service.js';
import {
  RECURRING_EXPENSE_INCLUDE,
  toRecurringExpenseDto,
  toUpcomingDto,
} from './recurring-expenses.mapper.js';
import type {
  RecurringExpenseDto,
  UpcomingRecurringExpenseDto,
} from './recurring-expenses.mapper.js';
import type {
  CreateRecurringExpenseDto,
  UpdateRecurringExpenseDto,
} from './recurring-expenses.schema.js';

const civilDateToday = (): Date => new Date(new Date().toISOString().slice(0, 10));

const isUniqueConstraintViolation = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';

export const createRecurringExpense = async (
  userId: string,
  householdId: string,
  dto: CreateRecurringExpenseDto,
): Promise<RecurringExpenseDto> => {
  const household = await assertHouseholdActive(householdId);
  if (dto.currencyCode !== household.defaultCurrencyCode) {
    throw new ValidationError(
      `Currency must match the household's currency (${household.defaultCurrencyCode})`,
      ErrorCode.INVALID_CURRENCY,
    );
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

  const currency = await prisma.currency.findUniqueOrThrow({ where: { code: dto.currencyCode } });
  const amount = roundToCurrency(dto.defaultAmount, currency.decimalPlaces);
  if (amount.lte(0)) {
    throw new ValidationError('Amount must be greater than zero');
  }

  // Validate the split shape/invariants up front, using the same domain
  // functions the generator will use later — a template that can never
  // produce a valid split shouldn't be creatable in the first place.
  computeSplits(
    dto.splitType,
    amount.toFixed(currency.decimalPlaces),
    dto.participants,
    currency.decimalPlaces,
  );

  const startDate = new Date(dto.startDate);
  const dayOfMonth =
    dto.dayOfMonth ?? (dto.frequency === 'monthly' ? startDate.getUTCDate() : undefined);

  const recurring = await prisma.recurringExpense.create({
    data: {
      householdId,
      categoryId: dto.categoryId ?? null,
      paidBy: dto.paidBy,
      description: dto.description,
      defaultAmount: amount.toFixed(currency.decimalPlaces),
      currencyCode: dto.currencyCode,
      splitType: dto.splitType,
      frequency: dto.frequency,
      dayOfMonth: dayOfMonth ?? null,
      startDate,
      endDate: dto.endDate ? new Date(dto.endDate) : null,
      nextRunDate: startDate,
      createdBy: userId,
      splits: {
        createMany: {
          data: dto.participants.map((p) => ({
            userId: p.userId,
            amount: p.amount ?? null,
            percentage: p.percentage !== undefined ? p.percentage.toString() : null,
            shares: p.shares ?? null,
          })),
        },
      },
    },
    include: RECURRING_EXPENSE_INCLUDE,
  });
  return toRecurringExpenseDto(recurring);
};

export const listRecurringExpenses = async (
  householdId: string,
): Promise<RecurringExpenseDto[]> => {
  const rows = await prisma.recurringExpense.findMany({
    where: { householdId, deletedAt: null },
    include: RECURRING_EXPENSE_INCLUDE,
    orderBy: { nextRunDate: 'asc' },
  });
  return rows.map(toRecurringExpenseDto);
};

export const getUpcoming = async (householdId: string): Promise<UpcomingRecurringExpenseDto[]> => {
  const rows = await prisma.recurringExpense.findMany({
    where: { householdId, deletedAt: null, isActive: true },
    include: RECURRING_EXPENSE_INCLUDE,
    orderBy: { nextRunDate: 'asc' },
  });
  const today = civilDateToday();
  return rows.map((r) => toUpcomingDto(r, today));
};

const loadOwnRecurringExpense = async (householdId: string, recurringExpenseId: string) => {
  const recurring = await prisma.recurringExpense.findFirst({
    where: { id: recurringExpenseId, householdId, deletedAt: null },
  });
  if (!recurring) {
    throw new NotFoundError('Recurring expense not found');
  }
  return recurring;
};

export const updateRecurringExpense = async (
  householdId: string,
  recurringExpenseId: string,
  dto: UpdateRecurringExpenseDto,
): Promise<RecurringExpenseDto> => {
  await loadOwnRecurringExpense(householdId, recurringExpenseId);
  if (dto.paidBy) {
    await assertActiveMembers(householdId, [dto.paidBy], ErrorCode.INVALID_PAYER);
  }
  if (dto.categoryId) {
    await assertValidCategory(householdId, dto.categoryId);
  }

  const recurring = await prisma.recurringExpense.update({
    where: { id: recurringExpenseId },
    data: {
      description: dto.description,
      categoryId: dto.categoryId,
      paidBy: dto.paidBy,
      endDate: dto.endDate === undefined ? undefined : dto.endDate ? new Date(dto.endDate) : null,
      isActive: dto.isActive,
    },
    include: RECURRING_EXPENSE_INCLUDE,
  });
  return toRecurringExpenseDto(recurring);
};

export const deleteRecurringExpense = async (
  householdId: string,
  recurringExpenseId: string,
): Promise<void> => {
  await loadOwnRecurringExpense(householdId, recurringExpenseId);
  await prisma.recurringExpense.update({
    where: { id: recurringExpenseId },
    data: { deletedAt: new Date() },
  });
};

/**
 * Materializes every overdue occurrence, across every household, as a
 * `pending` Expense (generate-recurring-occurrence.md). Safe to call any
 * number of times: the (recurringExpenseId, expenseDate) unique constraint
 * makes a repeat insert a no-op instead of a duplicate, and one recurring
 * expense's failure is logged and skipped rather than aborting the batch.
 *
 * Returns the number of occurrences actually created.
 */
export const generateDueOccurrences = async (today: Date = civilDateToday()): Promise<number> => {
  const due = await prisma.recurringExpense.findMany({
    where: { isActive: true, deletedAt: null, nextRunDate: { lte: today } },
    include: { splits: true, currency: true },
  });

  let generated = 0;
  for (const recurring of due) {
    try {
      const occurrenceDates = dueDates(
        recurring.nextRunDate,
        today,
        recurring.frequency,
        recurring.dayOfMonth ?? undefined,
      ).filter((date) => !recurring.endDate || date.getTime() <= recurring.endDate.getTime());

      let nextRunDate = recurring.nextRunDate;
      let lastGeneratedDate: Date | null = recurring.lastGeneratedDate;

      for (const occurrenceDate of occurrenceDates) {
        const splits = computeSplits(
          recurring.splitType,
          recurring.defaultAmount.toFixed(recurring.currency.decimalPlaces),
          recurring.splits.map((s) => ({
            userId: s.userId,
            amount: s.amount?.toString(),
            percentage: s.percentage ? Number(s.percentage) : undefined,
            shares: s.shares ?? undefined,
          })),
          recurring.currency.decimalPlaces,
        );

        try {
          await prisma.$transaction(async (tx) => {
            const expense = await tx.expense.create({
              data: {
                householdId: recurring.householdId,
                categoryId: recurring.categoryId,
                paidBy: recurring.paidBy,
                recurringExpenseId: recurring.id,
                description: recurring.description,
                amount: recurring.defaultAmount,
                currencyCode: recurring.currencyCode,
                splitType: recurring.splitType,
                expenseDate: occurrenceDate,
                status: 'pending',
                createdBy: recurring.createdBy,
              },
            });
            await tx.expenseSplit.createMany({
              data: splitsToRows(splits, recurring.currency.decimalPlaces).map((row) => ({
                ...row,
                expenseId: expense.id,
              })),
            });
          });
          generated += 1;
          lastGeneratedDate = occurrenceDate;
        } catch (error) {
          if (!isUniqueConstraintViolation(error)) {
            throw error;
          }
          // Already generated by an earlier run of this job — idempotent no-op.
        }

        nextRunDate = advanceDate(
          occurrenceDate,
          recurring.frequency,
          recurring.dayOfMonth ?? undefined,
        );
      }

      if (occurrenceDates.length > 0) {
        await prisma.recurringExpense.update({
          where: { id: recurring.id },
          data: { nextRunDate, lastGeneratedDate },
        });
      }
    } catch (error) {
      logger.error(
        { error, recurringExpenseId: recurring.id },
        'failed to generate recurring expense occurrence',
      );
    }
  }

  return generated;
};
