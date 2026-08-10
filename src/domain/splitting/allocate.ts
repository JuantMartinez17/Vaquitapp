import { Decimal } from 'decimal.js';
import { sumDecimals, type DecimalValue } from '../money/money.js';

/**
 * Distributes `total` across N parts according to `weights`, guaranteeing the
 * rounded parts sum to EXACTLY `total` (largest remainder method).
 *
 * The rounding "leftover cent" is assigned to the parts with the largest
 * fractional remainder; ties go to the lowest index (deterministic).
 *
 * Covers every expense split strategy:
 *  - equal:      weights = [1, 1, ...]
 *  - shares:     weights = [shares_i]
 *  - percentage: weights = [pct_i]
 *
 * @param total          Amount to distribute.
 * @param weights        Relative weights (non-negative, sum > 0).
 * @param decimalPlaces  Currency decimal places (default 2).
 * @returns              Array of Decimals whose sum == total.
 */
export const allocate = (
  total: DecimalValue,
  weights: DecimalValue[],
  decimalPlaces = 2,
): Decimal[] => {
  const totalDec = new Decimal(total);
  const weightDecs = weights.map((w) => new Decimal(w));

  if (weightDecs.length === 0) {
    throw new Error('allocate: at least one weight is required');
  }
  if (weightDecs.some((w) => w.isNegative())) {
    throw new Error('allocate: weights cannot be negative');
  }

  const totalWeight = sumDecimals(weightDecs);
  if (totalWeight.isZero()) {
    throw new Error('allocate: the sum of weights cannot be zero');
  }

  // Work in integer minimal units (e.g. cents) so the leftover distributes exactly.
  const factor = new Decimal(10).pow(decimalPlaces);
  const totalUnits = totalDec.times(factor).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);

  const ideal = weightDecs.map((w) => totalUnits.times(w).dividedBy(totalWeight));
  const floors = ideal.map((x) => x.floor());
  const allocatedUnits = sumDecimals(floors);

  // leftover = units still to distribute after rounding down. Always an exact
  // integer, since totalUnits and floors are both integers.
  let leftover = totalUnits.minus(allocatedUnits).toNumber();

  // Priority order for the leftover: largest fractional remainder first;
  // ties broken by the lower index.
  const order = ideal
    .map((x, index) => ({ index, frac: x.minus(floors[index]!) }))
    .sort((a, b) => {
      const cmp = b.frac.comparedTo(a.frac);
      return cmp !== 0 ? cmp : a.index - b.index;
    });

  const resultUnits = [...floors];
  let k = 0;
  while (leftover > 0) {
    const { index } = order[k % order.length]!;
    resultUnits[index] = resultUnits[index]!.plus(1);
    leftover -= 1;
    k += 1;
  }

  return resultUnits.map((u) => u.dividedBy(factor));
};
