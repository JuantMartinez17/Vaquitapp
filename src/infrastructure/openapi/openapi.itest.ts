import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from '../../app/app.js';
import { prisma } from '../database/prisma.js';

after(async () => {
  await prisma.$disconnect();
});

describe('OpenAPI docs', () => {
  it('serves a spec covering every mounted route without authentication', async () => {
    const res = await request(app).get('/docs/openapi.json').expect(200);
    assert.equal(res.body.openapi, '3.0.3');
    assert.ok(res.body.paths['/households/{householdId}/expenses'].post);
    assert.deepEqual(
      res.body.paths['/households/{householdId}/expenses'].post.parameters.find(
        (p: { name: string }) => p.name === 'Idempotency-Key',
      ).in,
      'header',
    );
    assert.equal(res.body.paths['/auth/login'].post.security, undefined);
  });

  it('serves the interactive HTML shell', async () => {
    const res = await request(app).get('/docs').expect(200);
    assert.match(res.headers['content-type'] ?? '', /html/);
    assert.match(res.text, /swagger-ui/);
  });
});
