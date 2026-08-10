import { Decimal } from 'decimal.js';

/**
 * Money utilities built on Decimal (decimal.js).
 *
 * GOLDEN RULE of the project: never use `number` for amounts. Floats silently
 * lose cents. Every money calculation goes through Decimal.
 */

export type DecimalValue = Decimal.Value;

export const toDecimal = (value: DecimalValue): Decimal => new Decimal(value);

export const sumDecimals = (values: DecimalValue[]): Decimal =>
  values.reduce<Decimal>((acc, v) => acc.plus(v), new Decimal(0));

/**
 * Rounds a value to the currency's decimal places (half-up).
 * E.g. ARS/USD use 2 decimals; CLP uses 0.
 */
export const roundToCurrency = (value: DecimalValue, decimalPlaces = 2): Decimal =>
  new Decimal(value).toDecimalPlaces(decimalPlaces, Decimal.ROUND_HALF_UP);

/**
 * Formats an amount as a fixed-decimal string. Used by mappers: amounts
 * travel as strings in JSON, never as numbers, so precision is never lost.
 */
export const formatMoney = (value: DecimalValue, decimalPlaces = 2): string =>
  new Decimal(value).toFixed(decimalPlaces);
