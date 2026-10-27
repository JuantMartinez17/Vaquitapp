import { z } from 'zod';

const CIVIL_DATE_FORMAT = /^(\d{4})-(\d{2})-(\d{2})$/;

// Postgres `date` has no year 0 (and JS reads years 0-99 as 1900-1999), so an
// unbounded `\d{4}` would let some values through to fail at the database.
export const MIN_CIVIL_YEAR = 1900;
export const MAX_CIVIL_YEAR = 2100;

/** True for a real calendar day written as `YYYY-MM-DD` (`2026-02-31` is not one). */
export const isCivilDate = (value: string): boolean => {
  const match = CIVIL_DATE_FORMAT.exec(value);
  if (!match) {
    return false;
  }
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])] as [
    number,
    number,
    number,
  ];
  if (year < MIN_CIVIL_YEAR || year > MAX_CIVIL_YEAR) {
    return false;
  }
  // Date.UTC rolls an overflowing day or month into the next one, so a date
  // that survives the round trip unchanged is a real one.
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
};

export const civilDateSchema = z
  .string()
  .refine(isCivilDate, 'Must be a real calendar date in YYYY-MM-DD format');
