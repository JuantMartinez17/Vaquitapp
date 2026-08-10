import { prisma } from '../../infrastructure/database/prisma.js';
import { ConflictError, NotFoundError, ValidationError } from '../../shared/errors/errors.js';
import { ErrorCode } from '../../shared/errors/codes.js';
import { roundToCurrency } from '../../domain/money/money.js';
import { parsePagination, buildPage } from '../../shared/utils/pagination.js';
import type { Page, PaginationQuery } from '../../shared/utils/pagination.js';
import { assertHouseholdActive, assertActiveMembers } from '../households/households.service.js';
import { assertValidCategory } from '../categories/categories.service.js';
import { INCOME_INCLUDE, toIncomeDto } from './incomes.mapper.js';
import type { IncomeDto } from './incomes.mapper.js';
import type { CreateIncomeDto, UpdateIncomeDto } from './incomes.schema.js';

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
  const household = await assertHouseholdActive(householdId);
  if (dto.currencyCode !== household.defaultCurrencyCode) {
    throw new ValidationError(
      `Currency must match the household's currency (${household.defaultCurrencyCode})`,
      ErrorCode.INVALID_CURRENCY,
    );
  }
  await assertActiveMembers(householdId, [dto.receivedBy], ErrorCode.NOT_A_MEMBER);
  if (dto.categoryId) {
    await assertValidCategory(householdId, dto.categoryId);
  }

  const currency = await prisma.currency.findUniqueOrThrow({ where: { code: dto.currencyCode } });
  const amount = roundToCurrency(dto.amount, currency.decimalPlaces);
  if (amount.lte(0)) {
    throw new ValidationError('Amount must be greater than zero');
  }

  const income = await prisma.income.create({
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
  return toIncomeDto(income);
};

const loadActiveIncome = async (householdId: string, incomeId: string) => {
  const income = await prisma.income.findFirst({ where: { id: incomeId, householdId } });
  if (!income) {
    throw new NotFoundError('Income not found');
  }
  if (income.voidedAt) {
    throw new ConflictError('Income was already voided', ErrorCode.INCOME_ALREADY_VOIDED);
  }
  return income;
};

export const updateIncome = async (
  householdId: string,
  incomeId: string,
  dto: UpdateIncomeDto,
): Promise<IncomeDto> => {
  await loadActiveIncome(householdId, incomeId);

  if (dto.receivedBy) {
    await assertActiveMembers(householdId, [dto.receivedBy], ErrorCode.NOT_A_MEMBER);
  }
  if (dto.categoryId) {
    await assertValidCategory(householdId, dto.categoryId);
  }

  let amount: string | undefined;
  if (dto.amount !== undefined) {
    const household = await assertHouseholdActive(householdId);
    const currency = await prisma.currency.findUniqueOrThrow({
      where: { code: household.defaultCurrencyCode },
    });
    const rounded = roundToCurrency(dto.amount, currency.decimalPlaces);
    if (rounded.lte(0)) {
      throw new ValidationError('Amount must be greater than zero');
    }
    amount = rounded.toFixed(currency.decimalPlaces);
  }

  const income = await prisma.income.update({
    where: { id: incomeId },
    data: {
      receivedBy: dto.receivedBy,
      description: dto.description,
      notes: dto.notes,
      categoryId: dto.categoryId,
      incomeDate: dto.incomeDate ? new Date(dto.incomeDate) : undefined,
      amount,
    },
    include: INCOME_INCLUDE,
  });
  return toIncomeDto(income);
};

export const voidIncome = async (householdId: string, incomeId: string): Promise<void> => {
  await loadActiveIncome(householdId, incomeId);
  await prisma.income.update({ where: { id: incomeId }, data: { voidedAt: new Date() } });
};

export const listIncomes = async (
  householdId: string,
  query: PaginationQuery,
): Promise<Page<IncomeDto>> => {
  const { take, cursor } = parsePagination(query);
  const rows = await prisma.income.findMany({
    where: { householdId, voidedAt: null },
    include: INCOME_INCLUDE,
    orderBy: [{ incomeDate: 'desc' }, { id: 'desc' }],
    take: take + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  const page = buildPage(rows, take);
  return { data: page.data.map(toIncomeDto), nextCursor: page.nextCursor };
};
