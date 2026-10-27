import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcrypt';
import { BCRYPT_COST, DUMMY_PASSWORD_HASH, hashPassword, verifyPassword } from './auth.password.js';

describe('password hashing', () => {
  it('keeps the dummy hash at the same cost as real hashes', () => {
    assert.equal(bcrypt.getRounds(DUMMY_PASSWORD_HASH), BCRYPT_COST);
  });

  it('verifies a correct password and rejects a wrong one', async () => {
    const hash = await hashPassword('Sup3rSecret!');
    assert.equal(await verifyPassword('Sup3rSecret!', hash), true);
    assert.equal(await verifyPassword('nope', hash), false);
  });

  it('never accepts a login when there is no hash, but still does the work', async () => {
    const startedAt = performance.now();
    assert.equal(await verifyPassword('anything', null), false);
    // A cost-12 compare takes far longer than this even on fast hardware; a
    // skipped compare would return in microseconds.
    assert.ok(performance.now() - startedAt > 20);
  });
});
