import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import request from 'supertest';
import { createUploadConcurrencyLimiter } from './upload-concurrency.middleware.js';
import { errorMiddleware } from '../../app/middleware/error.middleware.js';

/** An app whose only route parks until `open()` is called, to hold slots. */
const buildGatedApp = (limit: number) => {
  const waiting: Array<() => void> = [];
  const app = express();
  app.post('/upload', createUploadConcurrencyLimiter(limit), (_req, res) => {
    waiting.push(() => res.status(201).json({ ok: true }));
  });
  app.use(errorMiddleware);
  return {
    app,
    held: () => waiting.length,
    open: () => waiting.splice(0).forEach((respond) => respond()),
  };
};

const waitFor = async (condition: () => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 100 && !condition(); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.ok(condition(), 'condition was not met in time');
};

describe('upload concurrency limiter', () => {
  it('rejects excess uploads with 503, a stable code and Retry-After', async () => {
    const gate = buildGatedApp(2);
    const server = http.createServer(gate.app).listen(0);
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const first = fetch(`${url}/upload`, { method: 'POST' });
      const second = fetch(`${url}/upload`, { method: 'POST' });
      await waitFor(() => gate.held() === 2);

      const rejected = await request(url).post('/upload').expect(503);
      assert.equal(rejected.body.error.code, 'UPLOAD_CAPACITY_EXCEEDED');
      assert.equal(rejected.headers['retry-after'], '5');

      gate.open();
      assert.equal((await first).status, 201);
      assert.equal((await second).status, 201);
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });

  it('frees the slot once the response completes', async () => {
    const gate = buildGatedApp(1);
    const server = http.createServer(gate.app).listen(0);
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const held = fetch(`${url}/upload`, { method: 'POST' });
      await waitFor(() => gate.held() === 1);
      gate.open();
      await held;

      const next = fetch(`${url}/upload`, { method: 'POST' });
      await waitFor(() => gate.held() === 1);
      gate.open();
      assert.equal((await next).status, 201);
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });

  it('frees the slot when the client disconnects mid-request', async () => {
    const gate = buildGatedApp(1);
    const server = http.createServer(gate.app).listen(0);
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const controller = new AbortController();
      const aborted = fetch(`${url}/upload`, { method: 'POST', signal: controller.signal }).catch(
        () => undefined,
      );
      await waitFor(() => gate.held() === 1);
      controller.abort();
      await aborted;
      gate.open();
      // Give the server a moment to observe the closed socket.
      await new Promise((resolve) => setTimeout(resolve, 50));

      const next = fetch(`${url}/upload`, { method: 'POST' });
      await waitFor(() => gate.held() === 1);
      gate.open();
      assert.equal((await next).status, 201);
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });
});
