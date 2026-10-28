import { z } from 'zod';

/**
 * Free text bound for a database column. Postgres rejects a NUL character in
 * any text value, which would surface as a 500, so it is refused up front.
 */
export const textSchema = (maxLength: number, minLength = 1) =>
  z
    .string()
    .min(minLength)
    .max(maxLength)
    .refine((value) => !value.includes('\u0000'), 'Must not contain NUL characters');
