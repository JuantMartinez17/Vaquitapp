import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parsePagination, buildPage, DEFAULT_LIMIT } from './pagination.js';

describe('parsePagination', () => {
  it('uses the default limit when none is given', () => {
    assert.deepEqual(parsePagination({}), { take: DEFAULT_LIMIT, cursor: undefined });
  });

  it('clamps to the maximum allowed', () => {
    assert.equal(parsePagination({ limit: 5000 }, { maxLimit: 100 }).take, 100);
  });

  it('clamps to a minimum of 1', () => {
    assert.equal(parsePagination({ limit: 0 }).take, 1);
  });

  it('passes the cursor through', () => {
    assert.deepEqual(parsePagination({ limit: 10, cursor: 'abc' }), { take: 10, cursor: 'abc' });
  });
});

describe('buildPage', () => {
  it('has no next page when <= take items come back', () => {
    const items = [{ id: 'a' }, { id: 'b' }];
    assert.deepEqual(buildPage(items, 5), { data: items, nextCursor: null });
  });

  it('detects a next page and returns the last item as cursor', () => {
    const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]; // take+1
    const page = buildPage(items, 2);
    assert.deepEqual(page.data, [{ id: 'a' }, { id: 'b' }]);
    assert.equal(page.nextCursor, 'b');
  });
});
