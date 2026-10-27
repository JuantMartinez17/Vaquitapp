import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from '../../app/app.js';
import { prisma } from '../database/prisma.js';

after(async () => {
  await prisma.$disconnect();
});

const directive = (policy: string, name: string): string =>
  policy
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name} `)) ?? '';

describe('/docs content security policy', () => {
  it('lets Swagger UI load its bundle from the CDN without inline scripts', async () => {
    const res = await request(app).get('/docs').expect(200);
    const policy = String(res.headers['content-security-policy']);
    assert.match(directive(policy, 'script-src'), /https:\/\/unpkg\.com/);
    assert.doesNotMatch(directive(policy, 'script-src'), /unsafe-inline/);
    assert.match(directive(policy, 'style-src'), /https:\/\/unpkg\.com/);
    assert.doesNotMatch(res.text, /<script>/, 'the bootstrap must not be an inline script');
  });

  it('serves the bootstrap script same-origin', async () => {
    const res = await request(app).get('/docs/swagger-init.js').expect(200);
    assert.match(res.headers['content-type'] ?? '', /javascript/);
    assert.match(res.text, /SwaggerUIBundle/);
  });

  it('keeps the strict default policy on the rest of the API', async () => {
    const res = await request(app).get('/health').expect(200);
    const policy = String(res.headers['content-security-policy']);
    assert.doesNotMatch(policy, /unpkg\.com/);
  });
});

describe('CORS', () => {
  it('allows a configured origin and ignores others', async () => {
    const allowed = await request(app)
      .get('/health')
      .set('Origin', 'http://localhost:5173')
      .expect(200);
    assert.equal(allowed.headers['access-control-allow-origin'], 'http://localhost:5173');

    const other = await request(app)
      .get('/health')
      .set('Origin', 'https://evil.example')
      .expect(200);
    assert.equal(other.headers['access-control-allow-origin'], undefined);
  });
});
