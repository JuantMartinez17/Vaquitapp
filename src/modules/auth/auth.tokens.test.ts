import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { env } from '../../app/config.js';
import {
  signAccessToken,
  verifyAccessToken,
  generateRefreshToken,
  hashToken,
  refreshTokenExpiry,
} from './auth.tokens.js';

describe('access token', () => {
  it('signs and verifies a round-trip preserving sub/email', () => {
    const token = signAccessToken({ sub: 'user-123', email: 'a@b.com' });
    const payload = verifyAccessToken(token);
    assert.equal(payload.sub, 'user-123');
    assert.equal(payload.email, 'a@b.com');
  });

  it('rejects a malformed token', () => {
    assert.throws(() => verifyAccessToken('not-a-jwt'));
  });

  it('signs with HS256', () => {
    const token = signAccessToken({ sub: 'user-123', email: 'a@b.com' });
    assert.equal(jwt.decode(token, { complete: true })?.header.alg, 'HS256');
  });

  it('rejects a token signed with another algorithm, even with the right secret', () => {
    const forged = jwt.sign({ sub: 'user-123', email: 'a@b.com' }, env.JWT_ACCESS_SECRET, {
      algorithm: 'HS512',
    });
    assert.throws(() => verifyAccessToken(forged), /invalid algorithm/);
  });

  it('rejects an unsigned (alg none) token', () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify({ sub: 'user-123', email: 'a@b.com' })).toString(
      'base64url',
    );
    assert.throws(() => verifyAccessToken(`${header}.${body}.`));
  });
});

describe('refresh token', () => {
  it('generates a different opaque token each time', () => {
    const a = generateRefreshToken();
    const b = generateRefreshToken();
    assert.notEqual(a, b);
    assert.ok(a.length >= 40);
  });

  it('hashToken is deterministic and does not return the plain token', () => {
    const token = generateRefreshToken();
    assert.equal(hashToken(token), hashToken(token));
    assert.notEqual(hashToken(token), token);
    assert.equal(hashToken(token).length, 64); // sha256 hex
  });

  it('refreshTokenExpiry is in the future', () => {
    const now = new Date();
    assert.ok(refreshTokenExpiry(now).getTime() > now.getTime());
  });
});
