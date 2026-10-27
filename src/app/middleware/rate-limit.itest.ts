import { randomUUID } from 'node:crypto';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Express } from 'express';
import request from 'supertest';

// The test environment lifts every limit (scripts/test-env.mjs) so fixtures
// can register dozens of users. This file checks the real wiring on the real
// app, so it sets small limits first and imports the app only afterwards:
// config.ts reads the environment once, when it is first imported.
process.env.AUTH_RATE_LIMIT_MAX = '3';
process.env.AUTH_REGISTER_RATE_LIMIT_MAX = '2';
process.env.AUTH_REFRESH_RATE_LIMIT_MAX = '5';
process.env.API_RATE_LIMIT_MAX = '60';

let app: Express;
let disconnect: () => Promise<void>;

before(async () => {
  ({ app } = await import('../app.js'));
  const { prisma } = await import('../../infrastructure/database/prisma.js');
  disconnect = () => prisma.$disconnect();
});

after(async () => {
  await disconnect();
});

const credentials = () => {
  const id = randomUUID().replace(/-/g, '');
  return {
    email: `rl_${id}@example.test`,
    username: `rl_${id}`,
    password: 'Sup3rSecret!',
    displayName: 'Rate Limit',
  };
};

describe('auth rate limiters', () => {
  const user = credentials();

  it('limits register on its own budget', async () => {
    await request(app).post('/api/v1/auth/register').send(user).expect(201);
    await request(app).post('/api/v1/auth/register').send(credentials()).expect(201);
    const blocked = await request(app)
      .post('/api/v1/auth/register')
      .send(credentials())
      .expect(429);
    assert.equal(blocked.body.error.code, 'RATE_LIMITED');
  });

  it('login ignores successful attempts and blocks after repeated failures', async () => {
    for (let attempt = 0; attempt < 6; attempt++) {
      await request(app)
        .post('/api/v1/auth/login')
        .send({ email: user.email, password: user.password })
        .expect(200);
    }

    for (let attempt = 0; attempt < 3; attempt++) {
      await request(app)
        .post('/api/v1/auth/login')
        .send({ email: user.email, password: 'wrong-password' })
        .expect(401);
    }
    await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: 'wrong-password' })
      .expect(429);
  });

  it('refresh keeps working while login and register are exhausted, up to its own limit', async () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const res = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: 'not-a-real-token' });
      assert.notEqual(res.status, 429, `attempt ${attempt + 1} must not be rate limited`);
    }
    await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: 'not-a-real-token' })
      .expect(429);
  });
});

describe('global API rate limiter', () => {
  it('eventually limits /api/v1 per IP but never the health probes', async () => {
    let limited = false;
    for (let attempt = 0; attempt < 80 && !limited; attempt++) {
      const res = await request(app).get('/api/v1/currencies');
      limited = res.status === 429;
    }
    assert.equal(limited, true, 'a burst beyond the limit is rejected');

    await request(app).get('/health').expect(200);
    await request(app).get('/health/ready').expect(200);
  });
});
