import { Decimal } from 'decimal.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { assertHouseholdActive } from '../households/households.service.js';
import { formatMoney } from '../../domain/money/money.js';
import type { DateRangeQuery, OverTimeQuery } from './analytics.schema.js';

const loadHouseholdCurrency = async (householdId: string) => {
  const household = await assertHouseholdActive(householdId);
  const currency = await prisma.currency.findUniqueOrThrow({
    where: { code: household.defaultCurrencyCode },
  });
  return { household, currency };
};

const dateRangeFilter = (query: DateRangeQuery) => ({
  gte: new Date(query.from),
  lte: new Date(query.to),
});

export const getSummary = async (householdId: string, query: DateRangeQuery) => {
  const { household, currency } = await loadHouseholdCurrency(householdId);
  const expenseDate = dateRangeFilter(query);

  const [expenseAgg, incomeAgg] = await Promise.all([
    prisma.expense.aggregate({
      where: { householdId, status: 'active', expenseDate },
      _sum: { amount: true },
    }),
    prisma.income.aggregate({
      where: { householdId, voidedAt: null, incomeDate: expenseDate },
      _sum: { amount: true },
    }),
  ]);

  const totalSpent = new Decimal(expenseAgg._sum.amount ?? 0);
  const totalIncome = new Decimal(incomeAgg._sum.amount ?? 0);

  return {
    currencyCode: household.defaultCurrencyCode,
    from: query.from,
    to: query.to,
    totalSpent: formatMoney(totalSpent, currency.decimalPlaces),
    totalIncome: formatMoney(totalIncome, currency.decimalPlaces),
    net: formatMoney(totalIncome.minus(totalSpent), currency.decimalPlaces),
  };
};

export const getByCategory = async (householdId: string, query: DateRangeQuery) => {
  const { currency } = await loadHouseholdCurrency(householdId);
  const expenseDate = dateRangeFilter(query);

  const grouped = await prisma.expense.groupBy({
    by: ['categoryId'],
    where: { householdId, status: 'active', expenseDate },
    _sum: { amount: true },
  });

  const categoryIds = grouped.map((g) => g.categoryId).filter((id): id is string => id !== null);
  const categories = await prisma.category.findMany({ where: { id: { in: categoryIds } } });
  const nameById = new Map(categories.map((c) => [c.id, c.name]));

  return grouped
    .map((g) => ({
      categoryId: g.categoryId,
      categoryName: g.categoryId ? (nameById.get(g.categoryId) ?? 'Unknown') : 'Sin categoría',
      totalSpent: formatMoney(g._sum.amount ?? 0, currency.decimalPlaces),
    }))
    .sort((a, b) => Number(b.totalSpent) - Number(a.totalSpent));
};

export const getByMember = async (householdId: string, query: DateRangeQuery) => {
  const { currency } = await loadHouseholdCurrency(householdId);
  const expenseDate = dateRangeFilter(query);

  const splits = await prisma.expenseSplit.findMany({
    where: { expense: { householdId, status: 'active', expenseDate } },
    include: { user: true },
  });

  const totals = new Map<string, { displayName: string | null; total: Decimal }>();
  for (const split of splits) {
    const entry = totals.get(split.userId) ?? {
      displayName: split.user.displayName,
      total: new Decimal(0),
    };
    entry.total = entry.total.plus(split.amount);
    totals.set(split.userId, entry);
  }

  return [...totals.entries()]
    .map(([userId, { displayName, total }]) => ({
      userId,
      displayName,
      totalSpent: formatMoney(total, currency.decimalPlaces),
    }))
    .sort((a, b) => Number(b.totalSpent) - Number(a.totalSpent));
};

interface OverTimeRow {
  bucket: Date;
  total: Decimal | null;
}

export const getOverTime = async (householdId: string, query: OverTimeQuery) => {
  const { currency } = await loadHouseholdCurrency(householdId);

  const rows = await prisma.$queryRaw<OverTimeRow[]>`
    SELECT DATE_TRUNC(${query.granularity}, "expense_date") AS bucket, SUM("amount") AS total
    FROM "expenses"
    WHERE "household_id" = ${householdId}::uuid
      AND "status" = 'active'
      AND "expense_date" >= ${new Date(query.from)}
      AND "expense_date" <= ${new Date(query.to)}
    GROUP BY bucket
    ORDER BY bucket ASC
  `;

  return rows.map((r) => ({
    date: r.bucket.toISOString().slice(0, 10),
    totalSpent: formatMoney(r.total ?? 0, currency.decimalPlaces),
  }));
};

export const getComparison = async (householdId: string, query: DateRangeQuery) => {
  const fromDate = new Date(query.from);
  const toDate = new Date(query.to);
  const periodDays = Math.round((toDate.getTime() - fromDate.getTime()) / 86_400_000) + 1;

  const previousTo = new Date(fromDate.getTime() - 86_400_000);
  const previousFrom = new Date(previousTo.getTime() - (periodDays - 1) * 86_400_000);

  const [current, previous] = await Promise.all([
    getSummary(householdId, query),
    getSummary(householdId, {
      from: previousFrom.toISOString().slice(0, 10),
      to: previousTo.toISOString().slice(0, 10),
    }),
  ]);

  return { current, previous };
};
