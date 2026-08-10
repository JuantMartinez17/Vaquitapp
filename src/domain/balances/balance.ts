import { Decimal } from 'decimal.js';
import type { DecimalValue } from '../money/money.js';

export interface ExpenseActivity {
  paidBy: string;
  amount: DecimalValue;
  splits: { userId: string; amount: DecimalValue }[];
}

export interface SettlementActivity {
  fromUser: string;
  toUser: string;
  amount: DecimalValue;
}

export interface Balance {
  userId: string;
  net: Decimal;
}

export interface SimplifiedTransfer {
  from: string;
  to: string;
  amount: Decimal;
}

/**
 * Derives each member's net balance from financial activity — never a
 * stored field (SPECS §7). Positive = owed money (creditor), negative =
 * owes money (debtor).
 *
 * net(member) = Σ(paid as payer) − Σ(own split) + Σ(settlements received)
 *             − Σ(settlements paid)
 *
 * Income and Transfer never appear here: they don't move balances between
 * members (SPECS §6.2, §6.3).
 */
export const calculateBalances = (
  expenses: ExpenseActivity[],
  settlements: SettlementActivity[],
): Balance[] => {
  const net = new Map<string, Decimal>();
  const add = (userId: string, delta: Decimal): void => {
    net.set(userId, (net.get(userId) ?? new Decimal(0)).plus(delta));
  };

  for (const expense of expenses) {
    add(expense.paidBy, new Decimal(expense.amount));
    for (const split of expense.splits) {
      add(split.userId, new Decimal(split.amount).negated());
    }
  }

  for (const settlement of settlements) {
    const amount = new Decimal(settlement.amount);
    // fromUser is the one paying off their debt: their balance moves toward
    // zero (increases). toUser received the payment: theirs decreases.
    add(settlement.fromUser, amount);
    add(settlement.toUser, amount.negated());
  }

  return [...net.entries()]
    .map(([userId, value]) => ({ userId, net: value }))
    .sort((a, b) => a.userId.localeCompare(b.userId));
};

const byRemainingDesc = (
  a: { userId: string; remaining: Decimal },
  b: { userId: string; remaining: Decimal },
): number => {
  const cmp = b.remaining.comparedTo(a.remaining);
  return cmp !== 0 ? cmp : a.userId.localeCompare(b.userId);
};

/**
 * Nets reciprocal debts into the minimal set of transfers that clears every
 * balance: repeatedly match the largest creditor against the largest
 * debtor. Ties break by userId for a deterministic, reproducible result.
 */
export const simplifyDebts = (balances: Balance[]): SimplifiedTransfer[] => {
  const creditors = balances
    .filter((b) => b.net.isPositive())
    .map((b) => ({ userId: b.userId, remaining: b.net }))
    .sort(byRemainingDesc);
  const debtors = balances
    .filter((b) => b.net.isNegative())
    .map((b) => ({ userId: b.userId, remaining: b.net.negated() }))
    .sort(byRemainingDesc);

  const transfers: SimplifiedTransfer[] = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const debtor = debtors[i]!;
    const creditor = creditors[j]!;
    const amount = Decimal.min(debtor.remaining, creditor.remaining);
    if (amount.isPositive()) {
      transfers.push({ from: debtor.userId, to: creditor.userId, amount });
    }
    debtor.remaining = debtor.remaining.minus(amount);
    creditor.remaining = creditor.remaining.minus(amount);
    if (debtor.remaining.isZero()) i += 1;
    if (creditor.remaining.isZero()) j += 1;
  }
  return transfers;
};
