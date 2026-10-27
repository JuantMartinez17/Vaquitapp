import { prisma } from '../../infrastructure/database/prisma.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { logger } from '../../infrastructure/logging/logger.js';
import { NotFoundError, ValidationError } from '../../shared/errors/errors.js';
import { ErrorCode } from '../../shared/errors/codes.js';
import { roundToCurrency } from '../../domain/money/money.js';
import { advanceDate, dueDates } from '../../domain/recurrence/schedule.js';
import {
  assertHouseholdActive,
  assertActiveMembers,
  lockHouseholdShared,
} from '../households/households.service.js';
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

export const createRecurringExpense = async (
  userId: string,
  householdId: string,
  dto: CreateRecurringExpenseDto,
): Promise<RecurringExpenseDto> => {
  // One transaction from the lock to the insert, so the payer, participants and
  // currency checked here are still the household's when the template lands.
  const recurring = await prisma.$transaction(async (tx) => {
    await lockHouseholdShared(tx, householdId);

    const household = await assertHouseholdActive(householdId, tx);
    if (dto.currencyCode !== household.defaultCurrencyCode) {
      throw new ValidationError(
        `Currency must match the household's currency (${household.defaultCurrencyCode})`,
        ErrorCode.INVALID_CURRENCY,
      );
    }
    await assertActiveMembers(householdId, [dto.paidBy], ErrorCode.INVALID_PAYER, tx);
    await assertActiveMembers(
      householdId,
      dto.participants.map((p) => p.userId),
      ErrorCode.INVALID_PARTICIPANT,
      tx,
    );
    if (dto.categoryId) {
      await assertValidCategory(householdId, dto.categoryId, tx);
    }

    const currency = await tx.currency.findUniqueOrThrow({ where: { code: dto.currencyCode } });
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

    return tx.recurringExpense.create({
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

  const recurring = await prisma.$transaction(async (tx) => {
    // The payer judged below must still be a member when the edit lands.
    await lockHouseholdShared(tx, householdId);

    if (dto.paidBy) {
      await assertActiveMembers(householdId, [dto.paidBy], ErrorCode.INVALID_PAYER, tx);
    }
    if (dto.categoryId) {
      await assertValidCategory(householdId, dto.categoryId, tx);
    }

    return tx.recurringExpense.update({
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
 * Upper bounds on one run, so a long outage cannot turn into thousands of
 * sequential round trips on a tiny instance. Leftover backlog is picked up
 * by the next run, because `nextRunDate` only advances over what was created.
 */
const MAX_OCCURRENCES_PER_TEMPLATE_PER_RUN = 62;
const TEMPLATE_BATCH_SIZE = 100;

// Only what generation reads; the default `include` would also pull every
// column of every split and the currency row.
const DUE_TEMPLATE_SELECT = {
  id: true,
  householdId: true,
  categoryId: true,
  paidBy: true,
  createdBy: true,
  description: true,
  defaultAmount: true,
  currencyCode: true,
  splitType: true,
  frequency: true,
  dayOfMonth: true,
  endDate: true,
  nextRunDate: true,
  lastGeneratedDate: true,
  currency: { select: { decimalPlaces: true } },
  splits: { select: { userId: true, amount: true, percentage: true, shares: true } },
} satisfies Prisma.RecurringExpenseSelect;

type DueTemplate = Prisma.RecurringExpenseGetPayload<{ select: typeof DUE_TEMPLATE_SELECT }>;

const isoDay = (date: Date): string => date.toISOString().slice(0, 10);

/**
 * Creates one template's overdue occurrences (up to the per-run cap) and
 * advances its schedule in the SAME transaction: a crash can never leave
 * occurrences created with `nextRunDate` still pointing at them, nor the
 * schedule moved past occurrences that do not exist.
 *
 * `skipDuplicates` (ON CONFLICT DO NOTHING) makes a re-run a no-op without
 * a unique violation, which would abort the whole transaction.
 *
 * Returns the number of occurrences actually created.
 */
const generateForTemplate = async (recurring: DueTemplate, today: Date): Promise<number> => {
  // Nothing past the end date is ever due, so cap the walk there.
  const until =
    recurring.endDate && recurring.endDate.getTime() < today.getTime() ? recurring.endDate : today;
  const occurrenceDates = dueDates(
    recurring.nextRunDate,
    until,
    recurring.frequency,
    recurring.dayOfMonth ?? undefined,
    MAX_OCCURRENCES_PER_TEMPLATE_PER_RUN,
  );

  const lastOccurrence = occurrenceDates[occurrenceDates.length - 1];
  if (!lastOccurrence) {
    // Due, yet no occurrence falls on or before the end date: the template
    // is finished. Deactivating it stops it from being reloaded on every run.
    await prisma.recurringExpense.update({
      where: { id: recurring.id },
      data: { isActive: false },
    });
    return 0;
  }

  const nextRunDate = advanceDate(
    lastOccurrence,
    recurring.frequency,
    recurring.dayOfMonth ?? undefined,
  );
  const isFinished =
    recurring.endDate !== null && nextRunDate.getTime() > recurring.endDate.getTime();

  // The split is the same for every occurrence of a template.
  const decimalPlaces = recurring.currency.decimalPlaces;
  const splitRows = splitsToRows(
    computeSplits(
      recurring.splitType,
      recurring.defaultAmount.toFixed(decimalPlaces),
      recurring.splits.map((s) => ({
        userId: s.userId,
        amount: s.amount?.toString(),
        percentage: s.percentage ? Number(s.percentage) : undefined,
        shares: s.shares ?? undefined,
      })),
      decimalPlaces,
    ),
    decimalPlaces,
  );

  return prisma.$transaction(async (tx) => {
    const created = await tx.expense.createManyAndReturn({
      data: occurrenceDates.map((expenseDate) => ({
        householdId: recurring.householdId,
        categoryId: recurring.categoryId,
        paidBy: recurring.paidBy,
        recurringExpenseId: recurring.id,
        description: recurring.description,
        amount: recurring.defaultAmount,
        currencyCode: recurring.currencyCode,
        splitType: recurring.splitType,
        expenseDate,
        status: 'pending' as const,
        createdBy: recurring.createdBy,
      })),
      skipDuplicates: true,
      select: { id: true, expenseDate: true },
    });

    if (created.length > 0) {
      await tx.expenseSplit.createMany({
        data: created.flatMap((expense) =>
          splitRows.map((row) => ({ ...row, expenseId: expense.id })),
        ),
      });
    }

    const lastCreated = created.reduce<Date | null>(
      (latest, expense) =>
        latest === null || expense.expenseDate.getTime() > latest.getTime()
          ? expense.expenseDate
          : latest,
      null,
    );
    // Guarded on the schedule we read: if an overlapping run already advanced
    // this template, its write wins and ours must not restore stale values.
    await tx.recurringExpense.updateMany({
      where: { id: recurring.id, nextRunDate: recurring.nextRunDate },
      data: {
        nextRunDate,
        lastGeneratedDate: lastCreated ?? recurring.lastGeneratedDate,
        ...(isFinished ? { isActive: false } : {}),
      },
    });
    return created.length;
  });
};

/**
 * Materializes every overdue occurrence, across every household, as a
 * `pending` Expense (generate-recurring-occurrence.md). Safe to call any
 * number of times: the (recurringExpenseId, expenseDate) unique constraint
 * makes a repeat insert a no-op instead of a duplicate, and one template's
 * failure is logged and skipped rather than aborting the batch.
 *
 * Templates are read in id-ordered batches so memory stays flat however many
 * are due; a failing template cannot starve the rest because the cursor
 * always moves forward.
 *
 * Returns the number of occurrences actually created.
 */
export const generateDueOccurrences = async (today: Date = civilDateToday()): Promise<number> => {
  let generated = 0;
  let afterId: string | undefined;

  for (;;) {
    const batch = await prisma.recurringExpense.findMany({
      where: {
        isActive: true,
        deletedAt: null,
        nextRunDate: { lte: today },
        ...(afterId ? { id: { gt: afterId } } : {}),
      },
      orderBy: { id: 'asc' },
      take: TEMPLATE_BATCH_SIZE,
      select: DUE_TEMPLATE_SELECT,
    });

    for (const recurring of batch) {
      try {
        generated += await generateForTemplate(recurring, today);
      } catch (error) {
        logger.error(
          {
            err: error,
            recurringExpenseId: recurring.id,
            nextRunDate: isoDay(recurring.nextRunDate),
          },
          'failed to generate recurring expense occurrence',
        );
      }
    }

    const last = batch[batch.length - 1];
    if (!last || batch.length < TEMPLATE_BATCH_SIZE) {
      return generated;
    }
    afterId = last.id;
  }
};
