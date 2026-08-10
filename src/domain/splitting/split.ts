import { Decimal } from 'decimal.js';
import { allocate } from './allocate.js';
import { sumDecimals, roundToCurrency } from '../money/money.js';
import type { DecimalValue } from '../money/money.js';

export interface SplitResult {
  userId: string;
  amount: Decimal;
  percentage?: Decimal;
  shares?: number;
}

/** The parts of a split don't sum to the expense total (`Σ(splits) == amount`, SPECS §8.3). */
export class SplitMismatchError extends Error {
  constructor(
    public expected: Decimal,
    public received: Decimal,
  ) {
    super(`Split amounts sum to ${received.toFixed()}, expected ${expected.toFixed()}`);
    this.name = 'SplitMismatchError';
  }
}

/** Percentage splits must add up to exactly 100. */
export class PercentageMismatchError extends Error {
  constructor(public received: Decimal) {
    super(`Percentages sum to ${received.toFixed()}, expected 100`);
    this.name = 'PercentageMismatchError';
  }
}

/** Divides `amount` evenly across participants; the leftover cent goes to the largest remainder. */
export const splitEqual = (
  amount: DecimalValue,
  participants: string[],
  decimalPlaces = 2,
): SplitResult[] => {
  const parts = allocate(
    amount,
    participants.map(() => 1),
    decimalPlaces,
  );
  return participants.map((userId, i) => ({ userId, amount: parts[i]! }));
};

/**
 * Each participant's exact amount is given by the caller. Unlike the other
 * strategies, these amounts don't come from `allocate` — they're untrusted
 * input, so the sum has to be checked explicitly.
 */
export const splitExact = (
  amount: DecimalValue,
  participants: { userId: string; amount: DecimalValue }[],
  decimalPlaces = 2,
): SplitResult[] => {
  const parts = participants.map((p) => roundToCurrency(p.amount, decimalPlaces));
  const expected = roundToCurrency(amount, decimalPlaces);
  const received = sumDecimals(parts);
  if (!received.equals(expected)) {
    throw new SplitMismatchError(expected, received);
  }
  return participants.map((p, i) => ({ userId: p.userId, amount: parts[i]! }));
};

/** Each participant holds a percentage of the total; percentages must sum to 100. */
export const splitPercentage = (
  amount: DecimalValue,
  participants: { userId: string; percentage: DecimalValue }[],
  decimalPlaces = 2,
): SplitResult[] => {
  const percentages = participants.map((p) => new Decimal(p.percentage));
  const totalPercentage = sumDecimals(percentages);
  if (!totalPercentage.equals(100)) {
    throw new PercentageMismatchError(totalPercentage);
  }
  const parts = allocate(amount, percentages, decimalPlaces);
  return participants.map((p, i) => ({
    userId: p.userId,
    amount: parts[i]!,
    percentage: percentages[i]!,
  }));
};

/** Each participant holds a number of shares (e.g. 2:1:1); the amount splits proportionally. */
export const splitShares = (
  amount: DecimalValue,
  participants: { userId: string; shares: number }[],
  decimalPlaces = 2,
): SplitResult[] => {
  const parts = allocate(
    amount,
    participants.map((p) => p.shares),
    decimalPlaces,
  );
  return participants.map((p, i) => ({ userId: p.userId, amount: parts[i]!, shares: p.shares }));
};
