/**
 * The most hours any IANA zone runs ahead of UTC (Pacific/Kiritimati, +14:00).
 * No civil date on Earth is later than the UTC date of `now + 14h`.
 */
const MAX_UTC_OFFSET_MS = 14 * 60 * 60 * 1000;

const formatters = new Map<string, Intl.DateTimeFormat>();

const formatterFor = (timeZone: string): Intl.DateTimeFormat => {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    // Throws RangeError for a name that is not an IANA zone.
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
};

/** True when `timeZone` is an IANA zone name this runtime can resolve. */
export const isValidTimeZone = (timeZone: string): boolean => {
  try {
    formatterFor(timeZone);
    return true;
  } catch {
    return false;
  }
};

/**
 * The civil date (as UTC midnight, like every date column in this codebase)
 * that the wall clock shows in `timeZone` at the instant `now`.
 *
 * Throws RangeError when `timeZone` is not a valid IANA zone.
 */
export const civilDateInZone = (now: Date, timeZone: string): Date => {
  const parts = formatterFor(timeZone).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? '';
  return new Date(`${part('year')}-${part('month')}-${part('day')}T00:00:00.000Z`);
};

/**
 * The latest civil date any time zone shows at `now`: a safe upper bound for
 * a database prefilter before each row is judged in its own zone.
 */
export const latestCivilDateAnywhere = (now: Date): Date =>
  civilDateInZone(new Date(now.getTime() + MAX_UTC_OFFSET_MS), 'UTC');
