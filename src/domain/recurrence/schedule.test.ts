import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { advanceDate, dueDates } from './schedule.js';

const d = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);
const iso = (date: Date): string => date.toISOString().slice(0, 10);

describe('advanceDate', () => {
  it('advances daily, weekly and yearly by fixed offsets', () => {
    assert.equal(iso(advanceDate(d('2026-01-01'), 'daily')), '2026-01-02');
    assert.equal(iso(advanceDate(d('2026-01-01'), 'weekly')), '2026-01-08');
    assert.equal(iso(advanceDate(d('2026-01-01'), 'yearly')), '2027-01-01');
  });

  it('advances monthly to the same day next month', () => {
    assert.equal(iso(advanceDate(d('2026-01-15'), 'monthly')), '2026-02-15');
  });

  it('clamps a monthly dayOfMonth to the shorter month instead of overflowing', () => {
    // 2026 is not a leap year: February has 28 days.
    assert.equal(iso(advanceDate(d('2026-01-31'), 'monthly', 31)), '2026-02-28');
    assert.equal(iso(advanceDate(d('2026-02-28'), 'monthly', 31)), '2026-03-31');
  });

  it('handles the leap-year February correctly', () => {
    assert.equal(iso(advanceDate(d('2028-01-31'), 'monthly', 31)), '2028-02-29');
  });
});

describe('dueDates', () => {
  it('returns nothing when nextRunDate is in the future', () => {
    assert.deepEqual(dueDates(d('2026-06-01'), d('2026-05-01'), 'monthly'), []);
  });

  it('returns exactly one date when nextRunDate is today', () => {
    const dates = dueDates(d('2026-06-01'), d('2026-06-01'), 'monthly');
    assert.equal(dates.length, 1);
    assert.equal(iso(dates[0]!), '2026-06-01');
  });

  it('catches up every missed occurrence when the job did not run for a while', () => {
    const dates = dueDates(d('2026-06-01'), d('2026-06-04'), 'daily');
    assert.deepEqual(dates.map(iso), ['2026-06-01', '2026-06-02', '2026-06-03', '2026-06-04']);
  });
});
