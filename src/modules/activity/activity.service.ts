import { prisma } from '../../infrastructure/database/prisma.js';
import { assertHouseholdActive } from '../households/households.service.js';
import { formatMoney } from '../../domain/money/money.js';
import { parsePagination } from '../../shared/utils/pagination.js';
import type { PaginationQuery } from '../../shared/utils/pagination.js';

export type ActivityType = 'expense' | 'income' | 'transfer' | 'settlement';

export interface ActivityItem {
  id: string;
  type: ActivityType;
  date: string;
  amount: string;
  description: string;
}

interface ActivityPage {
  data: ActivityItem[];
  nextCursor: string | null;
}

interface Cursor {
  date: string;
  id: string;
}

const encodeCursor = (cursor: Cursor): string =>
  Buffer.from(JSON.stringify(cursor)).toString('base64url');

const decodeCursor = (raw: string): Cursor => {
  try {
    return JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Cursor;
  } catch {
    throw new Error('Invalid activity cursor');
  }
};

/**
 * Keyset condition for a single source table: strictly before the cursor's
 * (date, id), using id as a deterministic tiebreak for rows sharing a date.
 * `dateField` differs per model (expenseDate/incomeDate/...), hence the
 * dynamic key.
 */
const keysetWhere = (dateField: string, cursor: Cursor | null) => {
  if (!cursor) return {};
  const date = new Date(cursor.date);
  return { OR: [{ [dateField]: { lt: date } }, { [dateField]: date, id: { lt: cursor.id } }] };
};

interface Candidate extends ActivityItem {
  sortKey: string;
}

/**
 * Merges expenses, incomes, transfers and settlements into one
 * chronological, cursor-paginated feed (SPECS: unified activity timeline).
 *
 * Fetching `take + 1` from each of the four sources is enough to guarantee
 * both a correct top-`take` merge and a correct `hasMore`: the true next
 * item, if any, must be within the top `take + 1` of at least one source,
 * since the other `take` slots can absorb at most `take` higher-ranked
 * items across all sources combined.
 */
export const getActivity = async (
  householdId: string,
  query: PaginationQuery,
): Promise<ActivityPage> => {
  await assertHouseholdActive(householdId);
  const { take } = parsePagination(query);
  const cursor = query.cursor ? decodeCursor(query.cursor) : null;
  const limit = take + 1;

  const [expenses, incomes, transfers, settlements] = await Promise.all([
    prisma.expense.findMany({
      where: { householdId, status: 'active', ...keysetWhere('expenseDate', cursor) },
      orderBy: [{ expenseDate: 'desc' }, { id: 'desc' }],
      take: limit,
      include: { currency: true },
    }),
    prisma.income.findMany({
      where: { householdId, voidedAt: null, ...keysetWhere('incomeDate', cursor) },
      orderBy: [{ incomeDate: 'desc' }, { id: 'desc' }],
      take: limit,
      include: { currency: true },
    }),
    prisma.transfer.findMany({
      where: { householdId, voidedAt: null, ...keysetWhere('transferDate', cursor) },
      orderBy: [{ transferDate: 'desc' }, { id: 'desc' }],
      take: limit,
      include: { from: true, to: true, currency: true },
    }),
    prisma.settlement.findMany({
      where: { householdId, status: { not: 'voided' }, ...keysetWhere('settlementDate', cursor) },
      orderBy: [{ settlementDate: 'desc' }, { id: 'desc' }],
      take: limit,
      include: { from: true, to: true, currency: true },
    }),
  ]);

  const candidates: Candidate[] = [
    ...expenses.map((e) => ({
      id: e.id,
      type: 'expense' as const,
      date: e.expenseDate.toISOString().slice(0, 10),
      amount: formatMoney(e.amount, e.currency.decimalPlaces),
      description: e.description,
      sortKey: e.expenseDate.toISOString(),
    })),
    ...incomes.map((i) => ({
      id: i.id,
      type: 'income' as const,
      date: i.incomeDate.toISOString().slice(0, 10),
      amount: formatMoney(i.amount, i.currency.decimalPlaces),
      description: i.description,
      sortKey: i.incomeDate.toISOString(),
    })),
    ...transfers.map((t) => ({
      id: t.id,
      type: 'transfer' as const,
      date: t.transferDate.toISOString().slice(0, 10),
      amount: formatMoney(t.amount, t.currency.decimalPlaces),
      description: `${t.from.displayName ?? 'Someone'} → ${t.to.displayName ?? 'someone'}`,
      sortKey: t.transferDate.toISOString(),
    })),
    ...settlements.map((s) => ({
      id: s.id,
      type: 'settlement' as const,
      date: s.settlementDate.toISOString().slice(0, 10),
      amount: formatMoney(s.amount, s.currency.decimalPlaces),
      description: `${s.from.displayName ?? 'Someone'} → ${s.to.displayName ?? 'someone'}`,
      sortKey: s.settlementDate.toISOString(),
    })),
  ];

  candidates.sort((a, b) => {
    if (a.sortKey !== b.sortKey) return a.sortKey < b.sortKey ? 1 : -1;
    return a.id < b.id ? 1 : -1;
  });

  const hasMore = candidates.length > take;
  const page = candidates.slice(0, take);
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? encodeCursor({ date: last.sortKey, id: last.id }) : null;

  return {
    data: page.map(({ id, type, date, amount, description }) => ({
      id,
      type,
      date,
      amount,
      description,
    })),
    nextCursor,
  };
};
