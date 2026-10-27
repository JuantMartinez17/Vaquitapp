import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { app } from '../../app/app.js';
import { prisma } from '../database/prisma.js';
import { createHealthRouter } from './health.routes.js';

after(async () => {
  await prisma.$disconnect();
});

const appWithProbe = (probe: () => Promise<unknown>, timeoutMs: number) => {
  const probeApp = express();
  probeApp.use(createHealthRouter({ probe, timeoutMs }));
  return probeApp;
};

describe('health', () => {
  it('/health answers 200 without touching the database', async () => {
    let probed = false;
    const res = await request(
      appWithProbe(() => {
        probed = true;
        return Promise.resolve();
      }, 50),
    )
      .get('/health')
      .expect(200);
    assert.equal(res.body.status, 'ok');
    assert.equal(probed, false);
  });

  it('/health/ready answers 200 against the real database', async () => {
    const res = await request(app).get('/health/ready').expect(200);
    assert.equal(res.body.status, 'ready');
  });

  it('/health/ready answers 503 when the database ping fails', async () => {
    const res = await request(appWithProbe(() => Promise.reject(new Error('down')), 500))
      .get('/health/ready')
      .expect(503);
    assert.equal(res.body.status, 'not ready');
  });

  it('/health/ready answers 503 once the ping exceeds the timeout', async () => {
    const startedAt = Date.now();
    const res = await request(appWithProbe(() => new Promise<never>(() => undefined), 100))
      .get('/health/ready')
      .expect(503);
    assert.equal(res.body.database, 'disconnected');
    assert.ok(Date.now() - startedAt < 1_500, 'responds near the timeout, not when the ping ends');
  });

  it('echoes a safe X-Request-Id and replaces an unsafe one', async () => {
    const safe = await request(app).get('/health').set('X-Request-Id', 'trace-42').expect(200);
    assert.equal(safe.headers['x-request-id'], 'trace-42');

    const unsafe = await request(app)
      .get('/health')
      .set('X-Request-Id', 'x'.repeat(200))
      .expect(200);
    assert.notEqual(unsafe.headers['x-request-id'], 'x'.repeat(200));
    assert.ok((unsafe.headers['x-request-id'] ?? '').length <= 128);
  });
});
