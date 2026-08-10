import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from '../../app/app.js';
import { prisma } from '../database/prisma.js';

after(async () => {
  await prisma.$disconnect();
});

describe('OpenAPI docs', () => {
  // Route-by-route parity with the router is not asserted here: Express 5
  // does not expose mount prefixes on its layers, so reconstructing them
  // means parsing `matchers` internals. Coverage is kept by adding the
  // RouteSpec alongside the route — see openapi.spec.ts.
  it('serves the spec unauthenticated, with path, header and security metadata', async () => {
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
