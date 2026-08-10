import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseDurationMs, parseDurationSeconds } from './duration.js';

describe('parseDurationMs', () => {
  it('parses seconds, minutes, hours and days', () => {
    assert.equal(parseDurationMs('45s'), 45_000);
    assert.equal(parseDurationMs('15m'), 900_000);
    assert.equal(parseDurationMs('12h'), 43_200_000);
    assert.equal(parseDurationMs('30d'), 2_592_000_000);
  });

  it('throws on an invalid format', () => {
    assert.throws(() => parseDurationMs('15'));
    assert.throws(() => parseDurationMs('abc'));
    assert.throws(() => parseDurationMs('10w'));
  });
});

describe('parseDurationSeconds', () => {
  it('converts to seconds', () => {
    assert.equal(parseDurationSeconds('15m'), 900);
    assert.equal(parseDurationSeconds('1h'), 3600);
  });
});
