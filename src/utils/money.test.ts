import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Decimal } from 'decimal.js';
import { allocate, roundToCurrency, sumDecimals, formatMoney } from './money.js';

const asFixed = (values: Decimal[], dp = 2): string[] => values.map((v) => v.toFixed(dp));

describe('allocate', () => {
  it('reparte en partes iguales sin perder centavos (100 / 3)', () => {
    const parts = allocate(100, [1, 1, 1]);
    assert.deepEqual(asFixed(parts), ['33.34', '33.33', '33.33']);
    assert.equal(sumDecimals(parts).toFixed(2), '100.00');
  });

  it('reparte exacto cuando es divisible (10 / 4)', () => {
    const parts = allocate(10, [1, 1, 1, 1]);
    assert.deepEqual(asFixed(parts), ['2.50', '2.50', '2.50', '2.50']);
  });

  it('respeta los shares (pesos [1,2,1] sobre 100)', () => {
    const parts = allocate(100, [1, 2, 1]);
    assert.deepEqual(asFixed(parts), ['25.00', '50.00', '25.00']);
  });

  it('reparte por porcentaje (50/30/20)', () => {
    const parts = allocate(100, [50, 30, 20]);
    assert.deepEqual(asFixed(parts), ['50.00', '30.00', '20.00']);
  });

  it('asigna el centavo sobrante al mayor resto (10 / 3)', () => {
    const parts = allocate(10, [1, 1, 1]);
    assert.deepEqual(asFixed(parts), ['3.34', '3.33', '3.33']);
    assert.equal(sumDecimals(parts).toFixed(2), '10.00');
  });

  it('maneja montos chicos con sobrante (0.10 / 3)', () => {
    const parts = allocate('0.10', [1, 1, 1]);
    assert.deepEqual(asFixed(parts), ['0.04', '0.03', '0.03']);
    assert.equal(sumDecimals(parts).toFixed(2), '0.10');
  });

  it('soporta monedas sin decimales (CLP: 100 / 3, dp=0)', () => {
    const parts = allocate(100, [1, 1, 1], 0);
    assert.deepEqual(asFixed(parts, 0), ['34', '33', '33']);
    assert.equal(sumDecimals(parts).toFixed(0), '100');
  });

  it('un solo participante recibe el total', () => {
    const parts = allocate('57.99', [1]);
    assert.deepEqual(asFixed(parts), ['57.99']);
  });

  it('mantiene la invariante suma == total para muchos casos', () => {
    const totals = ['0.01', '0.07', '1', '9.99', '100', '1234.56', '99999.99'];
    const weightSets = [
      [1, 1, 1],
      [1, 2, 3, 4],
      [7, 7, 7, 7, 7, 7],
      [50, 25, 25],
    ];
    for (const total of totals) {
      for (const weights of weightSets) {
        const parts = allocate(total, weights);
        assert.equal(sumDecimals(parts).toFixed(2), new Decimal(total).toFixed(2));
      }
    }
  });

  it('lanza error con weights vacíos', () => {
    assert.throws(() => allocate(100, []));
  });

  it('lanza error con weight negativo', () => {
    assert.throws(() => allocate(100, [1, -1]));
  });

  it('lanza error si la suma de weights es cero', () => {
    assert.throws(() => allocate(100, [0, 0]));
  });
});

describe('roundToCurrency', () => {
  it('redondea half-up', () => {
    assert.equal(roundToCurrency('1.005').toFixed(2), '1.01');
    assert.equal(roundToCurrency('1.004').toFixed(2), '1.00');
  });

  it('respeta los decimales de la moneda', () => {
    assert.equal(roundToCurrency('1234.5', 0).toFixed(0), '1235');
  });
});

describe('sumDecimals', () => {
  it('suma sin error de punto flotante (0.1 + 0.2)', () => {
    assert.equal(sumDecimals(['0.1', '0.2']).toFixed(2), '0.30');
  });
});

describe('formatMoney', () => {
  it('formatea con decimales fijos', () => {
    assert.equal(formatMoney(5), '5.00');
    assert.equal(formatMoney('5.1'), '5.10');
    assert.equal(formatMoney(1234.5, 2), '1234.50');
  });
});
