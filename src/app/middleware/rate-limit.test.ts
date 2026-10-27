import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { createRateLimiter } from './rate-limit.middleware.js';
import { errorMiddleware } from './error.middleware.js';

const buildApp = (options: Parameters<typeof createRateLimiter>[0]) => {
  const app = express();
  // `?fail=1` makes the probe answer 401, like a wrong password would.
  app.post('/probe', createRateLimiter(options), (req, res) => {
    res.status(req.query.fail ? 401 : 200).json({ ok: !req.query.fail });
  });
  app.use(errorMiddleware);
  return app;
};

describe('createRateLimiter', () => {
  it('allows requests up to the limit, then rejects with 429 RATE_LIMITED', async () => {
    const app = buildApp({ limit: 2, windowMs: 60_000 });

    await request(app).post('/probe').expect(200);
    await request(app).post('/probe').expect(200);

    const blocked = await request(app).post('/probe').expect(429);
    assert.equal(blocked.body.error.code, 'RATE_LIMITED');
    assert.ok(Number(blocked.headers['retry-after']) > 0, 'tells the client when to retry');
  });

  it('with skipSuccessfulRequests, counts failed attempts only', async () => {
    const app = buildApp({ limit: 2, windowMs: 60_000, skipSuccessfulRequests: true });

    for (let attempt = 0; attempt < 6; attempt++) {
      await request(app).post('/probe').expect(200);
    }

    await request(app).post('/probe?fail=1').expect(401);
    await request(app).post('/probe?fail=1').expect(401);
    const blocked = await request(app).post('/probe?fail=1').expect(429);
    assert.equal(blocked.body.error.code, 'RATE_LIMITED');
  });

  it('keeps separate budgets for separate limiter instances', async () => {
    const strict = buildApp({ limit: 1, windowMs: 60_000 });
    const lenient = buildApp({ limit: 5, windowMs: 60_000 });

    await request(strict).post('/probe').expect(200);
    await request(strict).post('/probe').expect(429);
    await request(lenient).post('/probe').expect(200);
  });
});
