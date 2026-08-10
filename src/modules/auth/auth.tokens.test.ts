import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  signAccessToken,
  verifyAccessToken,
  generateRefreshToken,
  hashToken,
  refreshTokenExpiry,
} from './auth.tokens.js';

describe('access token', () => {
  it('firma y verifica un round-trip preservando sub/email', () => {
    const token = signAccessToken({ sub: 'user-123', email: 'a@b.com' });
    const payload = verifyAccessToken(token);
    assert.equal(payload.sub, 'user-123');
    assert.equal(payload.email, 'a@b.com');
  });

  it('rechaza un token corrupto', () => {
    assert.throws(() => verifyAccessToken('no-es-un-jwt'));
  });
});

describe('refresh token', () => {
  it('genera tokens opacos distintos cada vez', () => {
    const a = generateRefreshToken();
    const b = generateRefreshToken();
    assert.notEqual(a, b);
    assert.ok(a.length >= 40);
  });

  it('hashToken es determinístico y no devuelve el token en claro', () => {
    const token = generateRefreshToken();
    assert.equal(hashToken(token), hashToken(token));
    assert.notEqual(hashToken(token), token);
    assert.equal(hashToken(token).length, 64); // sha256 hex
  });

  it('refreshTokenExpiry es futuro', () => {
    const now = new Date();
    assert.ok(refreshTokenExpiry(now).getTime() > now.getTime());
  });
});
