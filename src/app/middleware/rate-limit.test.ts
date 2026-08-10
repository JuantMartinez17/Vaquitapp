import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { createAuthRateLimiter } from './rate-limit.middleware.js';
import { errorMiddleware } from './error.middleware.js';

const buildApp = (limit: number) => {
  const app = express();
  app.post('/probe', createAuthRateLimiter({ limit, windowMs: 60_000 }), (_req, res) => {
    res.status(200).json({ ok: true });
  });
  app.use(errorMiddleware);
  return app;
};

describe('authRateLimiter', () => {
  it('allows requests up to the limit, then rejects with 429 RATE_LIMITED', async () => {
    const app = buildApp(2);

    await request(app).post('/probe').expect(200);
    await request(app).post('/probe').expect(200);

    const blocked = await request(app).post('/probe').expect(429);
    assert.equal(blocked.body.error.code, 'RATE_LIMITED');
  });
});
