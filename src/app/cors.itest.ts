import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from './app.js';
import { prisma } from '../infrastructure/database/prisma.js';

after(async () => {
  await prisma.$disconnect();
});

const ALLOWED_ORIGIN = 'http://localhost:5173';

describe('CORS exposed headers', () => {
  it('lets a browser client read the headers it needs to act on', async () => {
    const res = await request(app).get('/api/v1/currencies').set('Origin', ALLOWED_ORIGIN);
    const exposed = String(res.headers['access-control-expose-headers'])
      .split(',')
      .map((name) => name.trim().toLowerCase());
    for (const name of [
      'retry-after',
      'idempotency-replayed',
      'x-request-id',
      'ratelimit-limit',
      'ratelimit-remaining',
      'ratelimit-reset',
    ]) {
      assert.ok(exposed.includes(name), `${name} should be exposed, got: ${exposed.join(', ')}`);
    }
  });

  it('exposes headers the API really sends, so the list does not drift', async () => {
    const res = await request(app).get('/api/v1/currencies').set('Origin', ALLOWED_ORIGIN);
    assert.ok(res.headers['x-request-id'], 'x-request-id is sent');
    assert.ok(res.headers['ratelimit-limit'], 'ratelimit-limit is sent');
  });

  it('still withholds the allow-origin header from an origin that is not allowed', async () => {
    const res = await request(app).get('/health').set('Origin', 'https://evil.example');
    assert.equal(res.headers['access-control-allow-origin'], undefined);
  });
});
