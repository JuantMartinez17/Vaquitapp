import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { roundToCurrency, sumDecimals, formatMoney } from './money.js';

describe('roundToCurrency', () => {
  it('rounds half-up', () => {
    assert.equal(roundToCurrency('1.005').toFixed(2), '1.01');
    assert.equal(roundToCurrency('1.004').toFixed(2), '1.00');
  });

  it('respects the currency decimal places', () => {
    assert.equal(roundToCurrency('1234.5', 0).toFixed(0), '1235');
  });
});

describe('sumDecimals', () => {
  it('sums without floating-point error (0.1 + 0.2)', () => {
    assert.equal(sumDecimals(['0.1', '0.2']).toFixed(2), '0.30');
  });
});

describe('formatMoney', () => {
  it('formats with a fixed number of decimals', () => {
    assert.equal(formatMoney(5), '5.00');
    assert.equal(formatMoney('5.1'), '5.10');
    assert.equal(formatMoney(1234.5, 2), '1234.50');
  });
});
