import { prisma } from '../../infrastructure/database/prisma.js';
import { NotFoundError } from '../../shared/errors/errors.js';
import { ErrorCode } from '../../shared/errors/codes.js';
import { calculateBalances, simplifyDebts } from '../../domain/balances/balance.js';
import { formatMoney } from '../../domain/money/money.js';

const loadHouseholdWithCurrency = async (householdId: string) => {
  const household = await prisma.household.findFirst({
    where: { id: householdId, deletedAt: null },
    include: { defaultCurrency: true },
  });
  if (!household) {
    throw new NotFoundError('Household not found', ErrorCode.HOUSEHOLD_NOT_FOUND);
  }
  return household;
};

const computeHouseholdBalances = async (householdId: string) => {
  const household = await loadHouseholdWithCurrency(householdId);

  const [expenses, settlements, members] = await Promise.all([
    prisma.expense.findMany({
      where: { householdId, status: 'active' },
      include: { splits: true },
    }),
    prisma.settlement.findMany({ where: { householdId, status: { not: 'voided' } } }),
    prisma.householdMember.findMany({
      where: { householdId, leftAt: null },
      include: { user: true },
    }),
  ]);

  const displayNameById = new Map(members.map((m) => [m.userId, m.user.displayName]));

  const balances = calculateBalances(
    expenses.map((e) => ({
      paidBy: e.paidBy,
      amount: e.amount,
      splits: e.splits.map((s) => ({ userId: s.userId, amount: s.amount })),
    })),
    settlements.map((s) => ({ fromUser: s.fromUser, toUser: s.toUser, amount: s.amount })),
  );

  return { household, balances, displayNameById };
};

export const getBalances = async (householdId: string) => {
  const { household, balances, displayNameById } = await computeHouseholdBalances(householdId);
  return {
    currencyCode: household.defaultCurrencyCode,
    balances: balances
      .filter((b) => displayNameById.has(b.userId))
      .map((b) => ({
        userId: b.userId,
        displayName: displayNameById.get(b.userId) ?? null,
        net: formatMoney(b.net, household.defaultCurrency.decimalPlaces),
      })),
  };
};

export const getSimplifiedBalances = async (householdId: string) => {
  const { household, balances, displayNameById } = await computeHouseholdBalances(householdId);
  const simplified = simplifyDebts(balances);
  return {
    currencyCode: household.defaultCurrencyCode,
    simplified: simplified.map((t) => ({
      from: t.from,
      fromDisplayName: displayNameById.get(t.from) ?? null,
      to: t.to,
      toDisplayName: displayNameById.get(t.to) ?? null,
      amount: formatMoney(t.amount, household.defaultCurrency.decimalPlaces),
    })),
  };
};
