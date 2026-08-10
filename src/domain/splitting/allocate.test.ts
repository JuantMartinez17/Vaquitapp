import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Decimal } from 'decimal.js';
import { allocate } from './allocate.js';
import { sumDecimals } from '../money/money.js';

const asFixed = (values: Decimal[], dp = 2): string[] => values.map((v) => v.toFixed(dp));

describe('allocate', () => {
  it('splits into equal parts without losing cents (100 / 3)', () => {
    const parts = allocate(100, [1, 1, 1]);
    assert.deepEqual(asFixed(parts), ['33.34', '33.33', '33.33']);
    assert.equal(sumDecimals(parts).toFixed(2), '100.00');
  });

  it('splits exactly when evenly divisible (10 / 4)', () => {
    const parts = allocate(10, [1, 1, 1, 1]);
    assert.deepEqual(asFixed(parts), ['2.50', '2.50', '2.50', '2.50']);
  });

  it('respects shares (weights [1,2,1] over 100)', () => {
    const parts = allocate(100, [1, 2, 1]);
    assert.deepEqual(asFixed(parts), ['25.00', '50.00', '25.00']);
  });

  it('splits by percentage (50/30/20)', () => {
    const parts = allocate(100, [50, 30, 20]);
    assert.deepEqual(asFixed(parts), ['50.00', '30.00', '20.00']);
  });

  it('assigns the leftover cent to the largest remainder (10 / 3)', () => {
    const parts = allocate(10, [1, 1, 1]);
    assert.deepEqual(asFixed(parts), ['3.34', '3.33', '3.33']);
    assert.equal(sumDecimals(parts).toFixed(2), '10.00');
  });

  it('handles small amounts with a leftover (0.10 / 3)', () => {
    const parts = allocate('0.10', [1, 1, 1]);
    assert.deepEqual(asFixed(parts), ['0.04', '0.03', '0.03']);
    assert.equal(sumDecimals(parts).toFixed(2), '0.10');
  });

  it('supports zero-decimal currencies (CLP: 100 / 3, dp=0)', () => {
    const parts = allocate(100, [1, 1, 1], 0);
    assert.deepEqual(asFixed(parts, 0), ['34', '33', '33']);
    assert.equal(sumDecimals(parts).toFixed(0), '100');
  });

  it('a single participant receives the total', () => {
    const parts = allocate('57.99', [1]);
    assert.deepEqual(asFixed(parts), ['57.99']);
  });

  it('keeps the sum == total invariant across many cases', () => {
    const totals = ['0.01', '0.07', '1', '9.99', '100', '1234.56', '99999.99'];
    const weightSets = [
      [1, 1, 1],
      [1, 2, 3, 4],
      [7, 7, 7, 7, 7, 7],
      [50, 25, 25],
    ];
    for (const total of totals) {
      for (const weights of weightSets) {
        const parts = allocate(total, weights);
        assert.equal(sumDecimals(parts).toFixed(2), new Decimal(total).toFixed(2));
      }
    }
  });

  it('throws with empty weights', () => {
    assert.throws(() => allocate(100, []));
  });

  it('throws with a negative weight', () => {
    assert.throws(() => allocate(100, [1, -1]));
  });

  it('throws when weights sum to zero', () => {
    assert.throws(() => allocate(100, [0, 0]));
  });
});
