export type RecurrenceFrequency = 'daily' | 'weekly' | 'monthly' | 'yearly';

const daysInMonth = (year: number, monthIndex0: number): number =>
  new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate();

/**
 * Advances a civil date (stored as UTC midnight, matching every other date
 * column in this codebase — see CODESTYLE money/dates conventions) by one
 * occurrence of `frequency`.
 *
 * For `monthly`, `dayOfMonth` re-anchors the result to that day, clamped to
 * the shorter month when it doesn't exist (e.g. day 31 in a 30-day month) —
 * without this, repeatedly advancing from the 31st would drift onto
 * different days each time a short month is skipped.
 */
export const advanceDate = (
  date: Date,
  frequency: RecurrenceFrequency,
  dayOfMonth?: number,
): Date => {
  const next = new Date(date.getTime());
  switch (frequency) {
    case 'daily':
      next.setUTCDate(next.getUTCDate() + 1);
      break;
    case 'weekly':
      next.setUTCDate(next.getUTCDate() + 7);
      break;
    case 'monthly': {
      next.setUTCDate(1);
      next.setUTCMonth(next.getUTCMonth() + 1);
      const target = dayOfMonth ?? date.getUTCDate();
      next.setUTCDate(Math.min(target, daysInMonth(next.getUTCFullYear(), next.getUTCMonth())));
      break;
    }
    case 'yearly':
      next.setUTCFullYear(next.getUTCFullYear() + 1);
      break;
  }
  return next;
};

/**
 * Every occurrence date from `nextRunDate` up to and including `today`
 * (inclusive), in order — lets the generator catch up if the job didn't run
 * for several days (SPECS D5).
 */
export const dueDates = (
  nextRunDate: Date,
  today: Date,
  frequency: RecurrenceFrequency,
  dayOfMonth?: number,
): Date[] => {
  const dates: Date[] = [];
  let cursor = nextRunDate;
  while (cursor.getTime() <= today.getTime()) {
    dates.push(cursor);
    cursor = advanceDate(cursor, frequency, dayOfMonth);
  }
  return dates;
};
