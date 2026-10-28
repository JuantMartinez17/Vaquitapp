import { prisma } from '../../infrastructure/database/prisma.js';
import { ConflictError, NotFoundError, ValidationError } from '../../shared/errors/errors.js';
import { ErrorCode } from '../../shared/errors/codes.js';
import { roundToCurrency } from '../../domain/money/money.js';
import { parsePagination, buildPage } from '../../shared/utils/pagination.js';
import type { Page } from '../../shared/utils/pagination.js';
import {
  assertHouseholdActive,
  assertActiveMembers,
  lockHouseholdShared,
} from '../households/households.service.js';
import { assertValidCategory } from '../categories/categories.service.js';
import { INCOME_INCLUDE, toIncomeDto } from './incomes.mapper.js';
import type { IncomeDto } from './incomes.mapper.js';
import type { CreateIncomeDto, UpdateIncomeDto, ListIncomesQuery } from './incomes.schema.js';
import type { Prisma } from '../../generated/prisma/client.js';

export const getIncome = async (householdId: string, incomeId: string): Promise<IncomeDto> => {
  const income = await prisma.income.findFirst({
    where: { id: incomeId, householdId },
    include: INCOME_INCLUDE,
  });
  if (!income) {
    throw new NotFoundError('Income not found');
  }
  return toIncomeDto(income);
};

export const createIncome = async (
  userId: string,
  householdId: string,
  dto: CreateIncomeDto,
): Promise<IncomeDto> => {
  // One transaction from the lock to the insert, so the receiver and currency
  // checked here are still the household's when the income lands.
  const income = await prisma.$transaction(async (tx) => {
    await lockHouseholdShared(tx, householdId);

    const household = await assertHouseholdActive(householdId, tx);
    if (dto.currencyCode !== household.defaultCurrencyCode) {
      throw new ValidationError(
        `Currency must match the household's currency (${household.defaultCurrencyCode})`,
        ErrorCode.INVALID_CURRENCY,
      );
    }
    await assertActiveMembers(householdId, [dto.receivedBy], ErrorCode.NOT_A_MEMBER, tx);
    if (dto.categoryId) {
      await assertValidCategory(householdId, dto.categoryId, tx);
    }

    const currency = await tx.currency.findUniqueOrThrow({ where: { code: dto.currencyCode } });
    const amount = roundToCurrency(dto.amount, currency.decimalPlaces);
    if (amount.lte(0)) {
      throw new ValidationError('Amount must be greater than zero');
    }

    return tx.income.create({
      data: {
        householdId,
        receivedBy: dto.receivedBy,
        description: dto.description,
        notes: dto.notes ?? null,
        amount: amount.toFixed(currency.decimalPlaces),
        currencyCode: dto.currencyCode,
        categoryId: dto.categoryId ?? null,
        incomeDate: new Date(dto.incomeDate),
        createdBy: userId,
      },
      include: INCOME_INCLUDE,
    });
  });
  return toIncomeDto(income);
};

const incomeAlreadyVoided = () =>
  new ConflictError('Income was already voided', ErrorCode.INCOME_ALREADY_VOIDED);

const loadActiveIncome = async (householdId: string, incomeId: string) => {
  const income = await prisma.income.findFirst({ where: { id: incomeId, householdId } });
  if (!income) {
    throw new NotFoundError('Income not found');
  }
  if (income.voidedAt) {
    throw incomeAlreadyVoided();
  }
  return income;
};

/**
 * A conditional update matched no row. Re-reads to say why, so losing a race
 * gives the same answer as the sequential case: 404 when the income is not in
 * this household, otherwise "already voided".
 */
const rejectUnmatchedIncome = async (
  db: Prisma.TransactionClient,
  householdId: string,
  incomeId: string,
): Promise<never> => {
  const exists = await db.income.count({ where: { id: incomeId, householdId } });
  if (exists === 0) {
    throw new NotFoundError('Income not found');
  }
  throw incomeAlreadyVoided();
};

export const updateIncome = async (
  householdId: string,
  incomeId: string,
  dto: UpdateIncomeDto,
): Promise<IncomeDto> => {
  // Read up front so a missing or voided income is reported before the body
  // is judged; the write below re-checks the state atomically.
  await loadActiveIncome(householdId, incomeId);

  return prisma.$transaction(async (tx) => {
    // The receiver and currency judged below must still hold when the edit lands.
    await lockHouseholdShared(tx, householdId);

    if (dto.receivedBy) {
      await assertActiveMembers(householdId, [dto.receivedBy], ErrorCode.NOT_A_MEMBER, tx);
    }
    if (dto.categoryId) {
      await assertValidCategory(householdId, dto.categoryId, tx);
    }

    let amount: string | undefined;
    if (dto.amount !== undefined) {
      const household = await assertHouseholdActive(householdId, tx);
      const currency = await tx.currency.findUniqueOrThrow({
        where: { code: household.defaultCurrencyCode },
      });
      const rounded = roundToCurrency(dto.amount, currency.decimalPlaces);
      if (rounded.lte(0)) {
        throw new ValidationError('Amount must be greater than zero');
      }
      amount = rounded.toFixed(currency.decimalPlaces);
    }

    // `voidedAt: null` in the filter keeps an edit from landing on an income
    // that was voided after the read above.
    const updated = await tx.income.updateMany({
      where: { id: incomeId, householdId, voidedAt: null },
      data: {
        receivedBy: dto.receivedBy,
        description: dto.description,
        notes: dto.notes,
        categoryId: dto.categoryId,
        incomeDate: dto.incomeDate ? new Date(dto.incomeDate) : undefined,
        amount,
      },
    });
    if (updated.count === 0) {
      await rejectUnmatchedIncome(tx, householdId, incomeId);
    }
    const income = await tx.income.findUniqueOrThrow({
      where: { id: incomeId },
      include: INCOME_INCLUDE,
    });
    return toIncomeDto(income);
  });
};

export const voidIncome = async (householdId: string, incomeId: string): Promise<void> => {
  const voided = await prisma.income.updateMany({
    where: { id: incomeId, householdId, voidedAt: null },
    data: { voidedAt: new Date() },
  });
  if (voided.count === 0) {
    await rejectUnmatchedIncome(prisma, householdId, incomeId);
  }
};

export const listIncomes = async (
  householdId: string,
  query: ListIncomesQuery,
): Promise<Page<IncomeDto>> => {
  const { take, cursor } = parsePagination(query);
  const rows = await prisma.income.findMany({
    where: { householdId, ...(query.includeVoided === 'true' ? {} : { voidedAt: null }) },
    include: INCOME_INCLUDE,
    orderBy: [{ incomeDate: 'desc' }, { id: 'desc' }],
    take: take + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  const page = buildPage(rows, take);
  return { data: page.data.map(toIncomeDto), nextCursor: page.nextCursor };
};
