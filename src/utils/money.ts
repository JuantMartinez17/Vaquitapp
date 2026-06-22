import { Decimal } from 'decimal.js';

/**
 * Utilidades de dinero basadas en Decimal (decimal.js).
 *
 * REGLA DE ORO del proyecto: nunca usar `number` para montos. Los floats
 * pierden centavos silenciosamente. Todo cálculo de plata pasa por Decimal.
 */

export type DecimalValue = Decimal.Value;

export const toDecimal = (value: DecimalValue): Decimal => new Decimal(value);

export const sumDecimals = (values: DecimalValue[]): Decimal =>
  values.reduce<Decimal>((acc, v) => acc.plus(v), new Decimal(0));

/**
 * Redondea un valor a la cantidad de decimales de la moneda (half-up).
 * Ej.: ARS/USD usan 2 decimales; CLP usa 0.
 */
export const roundToCurrency = (value: DecimalValue, decimalPlaces = 2): Decimal =>
  new Decimal(value).toDecimalPlaces(decimalPlaces, Decimal.ROUND_HALF_UP);

/**
 * Formatea un monto como string con la cantidad fija de decimales.
 * Pensado para los mappers: en JSON los montos viajan como string, nunca
 * como number, para no perder precisión.
 */
export const formatMoney = (value: DecimalValue, decimalPlaces = 2): string =>
  new Decimal(value).toFixed(decimalPlaces);

/**
 * Reparte `total` entre N partes según `weights`, garantizando que la suma de
 * las partes redondeadas sea EXACTAMENTE igual a `total` (método del mayor
 * resto / largest remainder).
 *
 * El "centavo sobrante" por redondeo se asigna a las partes con mayor resto
 * fraccionario; ante empate, gana el índice más bajo (determinístico).
 *
 * Sirve para todos los tipos de división de un gasto:
 *  - equal:      weights = [1, 1, ...]
 *  - shares:     weights = [shares_i]
 *  - percentage: weights = [pct_i]
 *
 * @param total          Monto a repartir.
 * @param weights        Pesos relativos (no negativos, suma > 0).
 * @param decimalPlaces  Decimales de la moneda (default 2).
 * @returns              Array de Decimals cuya suma == total.
 */
export const allocate = (
  total: DecimalValue,
  weights: DecimalValue[],
  decimalPlaces = 2,
): Decimal[] => {
  const totalDec = new Decimal(total);
  const weightDecs = weights.map((w) => new Decimal(w));

  if (weightDecs.length === 0) {
    throw new Error('allocate: se requiere al menos un weight');
  }
  if (weightDecs.some((w) => w.isNegative())) {
    throw new Error('allocate: los weights no pueden ser negativos');
  }

  const totalWeight = sumDecimals(weightDecs);
  if (totalWeight.isZero()) {
    throw new Error('allocate: la suma de los weights no puede ser cero');
  }

  // Trabajamos en "unidades mínimas" enteras (ej. centavos) para que el
  // reparto del sobrante sea exacto.
  const factor = new Decimal(10).pow(decimalPlaces);
  const totalUnits = totalDec.times(factor).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);

  const ideal = weightDecs.map((w) => totalUnits.times(w).dividedBy(totalWeight));
  const floors = ideal.map((x) => x.floor());
  const allocatedUnits = sumDecimals(floors);

  // leftover = unidades que faltan repartir por el redondeo hacia abajo.
  // Es un entero exacto (totalUnits y floors son enteros).
  let leftover = totalUnits.minus(allocatedUnits).toNumber();

  // Orden de prioridad para recibir el sobrante: mayor resto fraccionario
  // primero; empate → índice menor.
  const order = ideal
    .map((x, index) => ({ index, frac: x.minus(floors[index]!) }))
    .sort((a, b) => {
      const cmp = b.frac.comparedTo(a.frac);
      return cmp !== 0 ? cmp : a.index - b.index;
    });

  const resultUnits = [...floors];
  let k = 0;
  while (leftover > 0) {
    const { index } = order[k % order.length]!;
    resultUnits[index] = resultUnits[index]!.plus(1);
    leftover -= 1;
    k += 1;
  }

  return resultUnits.map((u) => u.dividedBy(factor));
};
