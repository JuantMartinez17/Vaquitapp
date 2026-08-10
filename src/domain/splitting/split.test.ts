import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sumDecimals } from '../money/money.js';
import {
  splitEqual,
  splitExact,
  splitPercentage,
  splitShares,
  SplitMismatchError,
  PercentageMismatchError,
} from './split.js';

describe('splitEqual', () => {
  it('splits 100/3 without losing cents', () => {
    const splits = splitEqual(100, ['a', 'b', 'c']);
    assert.equal(sumDecimals(splits.map((s) => s.amount)).toFixed(2), '100.00');
    assert.deepEqual(
      splits.map((s) => s.amount.toFixed(2)),
      ['33.34', '33.33', '33.33'],
    );
  });

  it('gives the whole amount to a single participant', () => {
    const splits = splitEqual('57.99', ['a']);
    assert.equal(splits.length, 1);
    assert.equal(splits[0]!.amount.toFixed(2), '57.99');
  });

  it('supports zero-decimal currencies (CLP)', () => {
    const splits = splitEqual(100, ['a', 'b', 'c'], 0);
    assert.equal(sumDecimals(splits.map((s) => s.amount)).toFixed(0), '100');
  });
});

describe('splitExact', () => {
  it('accepts amounts that sum exactly to the total', () => {
    const splits = splitExact(100, [
      { userId: 'a', amount: '40.00' },
      { userId: 'b', amount: '60.00' },
    ]);
    assert.equal(splits[0]!.amount.toFixed(2), '40.00');
    assert.equal(splits[1]!.amount.toFixed(2), '60.00');
  });

  it('rejects amounts that do not sum to the total', () => {
    assert.throws(
      () =>
        splitExact(100, [
          { userId: 'a', amount: '40.00' },
          { userId: 'b', amount: '59.99' },
        ]),
      (error: unknown) => {
        assert.ok(error instanceof SplitMismatchError);
        assert.equal(error.expected.toFixed(2), '100.00');
        assert.equal(error.received.toFixed(2), '99.99');
        return true;
      },
    );
  });
});

describe('splitPercentage', () => {
  it('splits 50/30/20 exactly', () => {
    const splits = splitPercentage(100, [
      { userId: 'a', percentage: 50 },
      { userId: 'b', percentage: 30 },
      { userId: 'c', percentage: 20 },
    ]);
    assert.deepEqual(
      splits.map((s) => s.amount.toFixed(2)),
      ['50.00', '30.00', '20.00'],
    );
  });

  it('rejects percentages that do not sum to 100', () => {
    assert.throws(
      () =>
        splitPercentage(100, [
          { userId: 'a', percentage: 50 },
          { userId: 'b', percentage: 40 },
        ]),
      (error: unknown) => {
        assert.ok(error instanceof PercentageMismatchError);
        assert.equal(error.received.toFixed(0), '90');
        return true;
      },
    );
  });

  it('keeps sum(amounts) == total even when the split does not divide evenly', () => {
    const splits = splitPercentage(10, [
      { userId: 'a', percentage: 33.34 },
      { userId: 'b', percentage: 33.33 },
      { userId: 'c', percentage: 33.33 },
    ]);
    assert.equal(sumDecimals(splits.map((s) => s.amount)).toFixed(2), '10.00');
  });
});

describe('splitShares', () => {
  it('splits weights [1,2,1] over 100 proportionally', () => {
    const splits = splitShares(100, [
      { userId: 'a', shares: 1 },
      { userId: 'b', shares: 2 },
      { userId: 'c', shares: 1 },
    ]);
    assert.deepEqual(
      splits.map((s) => s.amount.toFixed(2)),
      ['25.00', '50.00', '25.00'],
    );
    assert.equal(splits[1]!.shares, 2);
  });
});
