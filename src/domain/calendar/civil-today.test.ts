import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { civilDateInZone, isValidTimeZone, latestCivilDateAnywhere } from './civil-today.js';

const at = (iso: string): Date => new Date(iso);
const day = (date: Date): string => date.toISOString().slice(0, 10);

describe('civilDateInZone', () => {
  const buenosAires = 'America/Argentina/Buenos_Aires'; // UTC-03:00, no DST

  it('returns the previous day in Buenos Aires while UTC has already rolled over', () => {
    // 22:00 in Buenos Aires is 01:00 UTC of the next day.
    assert.equal(day(civilDateInZone(at('2026-03-11T01:00:00Z'), buenosAires)), '2026-03-10');
  });

  it('flips exactly at local midnight in a negative-offset zone', () => {
    assert.equal(day(civilDateInZone(at('2026-03-10T02:59:59Z'), buenosAires)), '2026-03-09');
    assert.equal(day(civilDateInZone(at('2026-03-10T03:00:00Z'), buenosAires)), '2026-03-10');
  });

  it('returns the next day in a positive-offset zone while UTC is still behind', () => {
    // Asia/Tokyo is UTC+09:00 with no DST: 20:00 UTC is 05:00 the next day.
    assert.equal(day(civilDateInZone(at('2026-03-10T20:00:00Z'), 'Asia/Tokyo')), '2026-03-11');
    assert.equal(day(civilDateInZone(at('2026-03-10T14:59:59Z'), 'Asia/Tokyo')), '2026-03-10');
    assert.equal(day(civilDateInZone(at('2026-03-10T15:00:00Z'), 'Asia/Tokyo')), '2026-03-11');
  });

  it('matches the UTC date in UTC', () => {
    assert.equal(day(civilDateInZone(at('2026-12-31T23:59:59Z'), 'UTC')), '2026-12-31');
  });

  it('rolls over month and year boundaries', () => {
    assert.equal(day(civilDateInZone(at('2026-01-01T01:00:00Z'), buenosAires)), '2025-12-31');
    assert.equal(day(civilDateInZone(at('2026-02-28T20:00:00Z'), 'Asia/Tokyo')), '2026-03-01');
  });

  it('returns UTC midnight', () => {
    assert.equal(
      civilDateInZone(at('2026-03-10T12:34:56Z'), buenosAires).toISOString(),
      '2026-03-10T00:00:00.000Z',
    );
  });

  it('rejects a name that is not an IANA zone', () => {
    assert.throws(() => civilDateInZone(at('2026-03-10T12:00:00Z'), 'Mars/Olympus'), RangeError);
  });
});

describe('isValidTimeZone', () => {
  it('accepts IANA names and rejects anything else', () => {
    assert.equal(isValidTimeZone('America/Argentina/Buenos_Aires'), true);
    assert.equal(isValidTimeZone('Mars/Olympus'), false);
    assert.equal(isValidTimeZone(''), false);
  });
});

describe('latestCivilDateAnywhere', () => {
  it('is never earlier than the civil date of the furthest-ahead zone', () => {
    // Pacific/Kiritimati is UTC+14:00.
    for (const iso of ['2026-03-10T09:59:59Z', '2026-03-10T10:00:00Z', '2026-03-10T23:00:00Z']) {
      const now = at(iso);
      assert.ok(
        latestCivilDateAnywhere(now).getTime() >=
          civilDateInZone(now, 'Pacific/Kiritimati').getTime(),
      );
    }
  });

  it('is one day ahead of UTC from 10:00 UTC onwards', () => {
    assert.equal(day(latestCivilDateAnywhere(at('2026-03-10T09:59:59Z'))), '2026-03-10');
    assert.equal(day(latestCivilDateAnywhere(at('2026-03-10T10:00:00Z'))), '2026-03-11');
  });
});
