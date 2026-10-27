import { Decimal } from 'decimal.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { NotFoundError } from '../../shared/errors/errors.js';
import { ErrorCode } from '../../shared/errors/codes.js';
import { formatMoney } from '../../domain/money/money.js';
import type { DateRangeQuery, OverTimeQuery } from './analytics.schema.js';

interface HouseholdCurrency {
  currencyCode: string;
  decimalPlaces: number;
}

/** One query for the active household and its currency's precision. */
const loadHouseholdCurrency = async (householdId: string): Promise<HouseholdCurrency> => {
  const household = await prisma.household.findFirst({
    where: { id: householdId, deletedAt: null },
    select: { defaultCurrencyCode: true, defaultCurrency: { select: { decimalPlaces: true } } },
  });
  if (!household) {
    throw new NotFoundError('Household not found', ErrorCode.HOUSEHOLD_NOT_FOUND);
  }
  return {
    currencyCode: household.defaultCurrencyCode,
    decimalPlaces: household.defaultCurrency.decimalPlaces,
  };
};

const dateRangeFilter = (query: DateRangeQuery) => ({
  gte: new Date(query.from),
  lte: new Date(query.to),
});

/** Largest total first; equal totals fall back to the key so the order is stable. */
const byTotalDesc = (a: { total: Decimal; key: string }, b: { total: Decimal; key: string }) =>
  b.total.comparedTo(a.total) || a.key.localeCompare(b.key);

const computeSummary = async (
  householdId: string,
  currency: HouseholdCurrency,
  query: DateRangeQuery,
) => {
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
    currencyCode: currency.currencyCode,
    from: query.from,
    to: query.to,
    totalSpent: formatMoney(totalSpent, currency.decimalPlaces),
    totalIncome: formatMoney(totalIncome, currency.decimalPlaces),
    net: formatMoney(totalIncome.minus(totalSpent), currency.decimalPlaces),
  };
};

export const getSummary = async (householdId: string, query: DateRangeQuery) =>
  computeSummary(householdId, await loadHouseholdCurrency(householdId), query);

export const getByCategory = async (householdId: string, query: DateRangeQuery) => {
  const currency = await loadHouseholdCurrency(householdId);
  const expenseDate = dateRangeFilter(query);

  const grouped = await prisma.expense.groupBy({
    by: ['categoryId'],
    where: { householdId, status: 'active', expenseDate },
    _sum: { amount: true },
  });

  const categoryIds = grouped.map((g) => g.categoryId).filter((id): id is string => id !== null);
  const categories = await prisma.category.findMany({
    where: { id: { in: categoryIds } },
    select: { id: true, name: true },
  });
  const nameById = new Map(categories.map((c) => [c.id, c.name]));

  return grouped
    .map((g) => ({
      categoryId: g.categoryId,
      categoryName: g.categoryId ? (nameById.get(g.categoryId) ?? 'Unknown') : 'Sin categoría',
      total: new Decimal(g._sum.amount ?? 0),
    }))
    .sort((a, b) =>
      byTotalDesc(
        { total: a.total, key: a.categoryId ?? '' },
        { total: b.total, key: b.categoryId ?? '' },
      ),
    )
    .map(({ categoryId, categoryName, total }) => ({
      categoryId,
      categoryName,
      totalSpent: formatMoney(total, currency.decimalPlaces),
    }));
};

export const getByMember = async (householdId: string, query: DateRangeQuery) => {
  const currency = await loadHouseholdCurrency(householdId);
  const expenseDate = dateRangeFilter(query);

  // Summed by Postgres: the previous version streamed every split row (with
  // its user) into memory just to add them up.
  const grouped = await prisma.expenseSplit.groupBy({
    by: ['userId'],
    where: { expense: { householdId, status: 'active', expenseDate } },
    _sum: { amount: true },
  });

  const users = await prisma.user.findMany({
    where: { id: { in: grouped.map((g) => g.userId) } },
    select: { id: true, displayName: true },
  });
  const displayNameById = new Map(users.map((u) => [u.id, u.displayName]));

  return grouped
    .map((g) => ({
      userId: g.userId,
      displayName: displayNameById.get(g.userId) ?? null,
      total: new Decimal(g._sum.amount ?? 0),
    }))
    .sort((a, b) =>
      byTotalDesc({ total: a.total, key: a.userId }, { total: b.total, key: b.userId }),
    )
    .map(({ userId, displayName, total }) => ({
      userId,
      displayName,
      totalSpent: formatMoney(total, currency.decimalPlaces),
    }));
};

interface OverTimeRow {
  bucket: string;
  total: string | null;
}

export const getOverTime = async (householdId: string, query: OverTimeQuery) => {
  const currency = await loadHouseholdCurrency(householdId);

  // `expense_date` is a calendar `date`. DATE_TRUNC on a date silently
  // promotes it to timestamptz in the SESSION time zone, so the bucket would
  // depend on connection settings; truncating a plain `timestamp` and handing
  // back text keeps the bucket a pure calendar date end to end.
  const rows = await prisma.$queryRaw<OverTimeRow[]>`
    SELECT DATE_TRUNC(${query.granularity}, "expense_date"::timestamp)::date::text AS bucket,
           SUM("amount")::text AS total
    FROM "expenses"
    WHERE "household_id" = ${householdId}::uuid
      AND "status" = 'active'
      AND "expense_date" >= ${new Date(query.from)}
      AND "expense_date" <= ${new Date(query.to)}
    GROUP BY bucket
    ORDER BY bucket ASC
  `;

  return rows.map((r) => ({
    date: r.bucket,
    totalSpent: formatMoney(r.total ?? 0, currency.decimalPlaces),
  }));
};

export const getComparison = async (householdId: string, query: DateRangeQuery) => {
  const currency = await loadHouseholdCurrency(householdId);
  const fromDate = new Date(query.from);
  const toDate = new Date(query.to);
  const periodDays = Math.round((toDate.getTime() - fromDate.getTime()) / 86_400_000) + 1;

  const previousTo = new Date(fromDate.getTime() - 86_400_000);
  const previousFrom = new Date(previousTo.getTime() - (periodDays - 1) * 86_400_000);

  const [current, previous] = await Promise.all([
    computeSummary(householdId, currency, query),
    computeSummary(householdId, currency, {
      from: previousFrom.toISOString().slice(0, 10),
      to: previousTo.toISOString().slice(0, 10),
    }),
  ]);

  return { current, previous };
};
