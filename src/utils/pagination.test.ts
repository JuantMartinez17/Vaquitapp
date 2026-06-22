import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parsePagination, buildPage, DEFAULT_LIMIT } from './pagination.js';

describe('parsePagination', () => {
  it('usa el límite por defecto cuando no se pasa limit', () => {
    assert.deepEqual(parsePagination({}), { take: DEFAULT_LIMIT, cursor: undefined });
  });

  it('clampa al máximo permitido', () => {
    assert.equal(parsePagination({ limit: 5000 }, { maxLimit: 100 }).take, 100);
  });

  it('clampa al mínimo de 1', () => {
    assert.equal(parsePagination({ limit: 0 }).take, 1);
  });

  it('propaga el cursor', () => {
    assert.deepEqual(parsePagination({ limit: 10, cursor: 'abc' }), { take: 10, cursor: 'abc' });
  });
});

describe('buildPage', () => {
  it('sin próxima página cuando vienen <= take items', () => {
    const items = [{ id: 'a' }, { id: 'b' }];
    assert.deepEqual(buildPage(items, 5), { data: items, nextCursor: null });
  });

  it('detecta próxima página y devuelve el cursor del último item', () => {
    const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]; // take+1
    const page = buildPage(items, 2);
    assert.deepEqual(page.data, [{ id: 'a' }, { id: 'b' }]);
    assert.equal(page.nextCursor, 'b');
  });
});
