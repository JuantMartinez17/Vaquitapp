import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { civilDateSchema, isCivilDate } from './civil-date.schema.js';
import { moneyAmountSchema } from './money-amount.schema.js';
import { textSchema } from './text.schema.js';

describe('civilDateSchema', () => {
  it('accepts real calendar days, including leap days', () => {
    for (const value of ['2026-01-01', '2026-12-31', '2028-02-29', '1900-01-01', '2100-12-31']) {
      assert.equal(isCivilDate(value), true, value);
    }
  });

  it('rejects days that do not exist', () => {
    for (const value of ['2026-02-31', '2026-04-31', '2025-02-29', '2026-00-10', '2026-01-00']) {
      assert.equal(isCivilDate(value), false, value);
    }
  });

  it('rejects impossible months and malformed shapes', () => {
    for (const value of ['2026-13-01', '2026-1-1', '26-01-01', '2026/01/01', '', '2026-01-01T00']) {
      assert.equal(isCivilDate(value), false, value);
    }
  });

  it('rejects years outside what Postgres and JS agree on', () => {
    for (const value of ['0000-01-01', '0099-01-01', '1899-12-31', '2101-01-01', '9999-12-31']) {
      assert.equal(isCivilDate(value), false, value);
    }
  });

  it('reports a validation error through the schema', () => {
    assert.equal(civilDateSchema.safeParse('2026-02-31').success, false);
    assert.equal(civilDateSchema.safeParse('2026-02-28').success, true);
  });
});

describe('moneyAmountSchema', () => {
  it('accepts amounts that fit numeric(14,2)', () => {
    for (const value of ['0', '0.5', '10', '10.5', '10.50', '999999999999.99', '000.10']) {
      assert.equal(moneyAmountSchema.safeParse(value).success, true, value);
    }
  });

  it('rejects overflow, extra decimals and non-numeric text', () => {
    for (const value of [
      '1000000000000',
      '99999999999999.00',
      '10.123',
      '-1',
      '+1',
      '1e3',
      '1,5',
      '.5',
      '5.',
      '',
      ' 1',
    ]) {
      assert.equal(moneyAmountSchema.safeParse(value).success, false, value);
    }
  });
});

describe('textSchema', () => {
  it('enforces the length bounds', () => {
    const schema = textSchema(5);
    assert.equal(schema.safeParse('').success, false);
    assert.equal(schema.safeParse('abcde').success, true);
    assert.equal(schema.safeParse('abcdef').success, false);
    assert.equal(textSchema(5, 0).safeParse('').success, true);
  });

  it('rejects NUL characters', () => {
    assert.equal(textSchema(20).safeParse('a\u0000b').success, false);
  });
});
