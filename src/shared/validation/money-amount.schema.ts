import { z } from 'zod';

/**
 * Money columns are `numeric(14,2)`: at most 12 digits before the point and 2
 * after. Checking the shape here turns an out-of-range amount into a 422
 * instead of a numeric-overflow error from the database.
 *
 * Positivity is deliberately NOT checked here: each service rejects a zero
 * amount with its own domain code (INVALID_SETTLEMENT, INVALID_TRANSFER, ...)
 * after rounding to the currency, and that code is part of the API contract.
 */
export const MONEY_AMOUNT_PATTERN = /^\d{1,12}(\.\d{1,2})?$/;

export const moneyAmountSchema = z
  .string()
  .regex(MONEY_AMOUNT_PATTERN, 'Must be a decimal with at most 12 integer digits and 2 decimals');
