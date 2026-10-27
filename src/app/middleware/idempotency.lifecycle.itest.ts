import { createHash, randomUUID } from 'node:crypto';
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { RequestHandler } from 'express';
import request from 'supertest';
import { app } from '../app.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { registerTestUser } from '../../shared/testing/http.js';
import { asyncHandler } from '../../shared/utils/asyncHandler.js';
import { ConflictError, ValidationError } from '../../shared/errors/errors.js';
import { errorMiddleware } from './error.middleware.js';
import { idempotent } from './idempotency.middleware.js';

after(async () => {
  await prisma.$disconnect();
});

const ENDPOINT = 'POST /h/:householdId/things';
const HOUR_MS = 60 * 60 * 1000;

/**
 * A tiny app around the real middleware so each lifecycle rule can be driven
 * deterministically (a handler that blocks on a gate, one that fails once, ...)
 * instead of racing real endpoints.
 */
const buildMiniApp = (handler: RequestHandler) => {
  const mini = express();
  mini.use(express.json());
  mini.use((req, _res, next) => {
    req.user = { id: String(req.headers['x-test-user']), email: 'mini@example.test' };
    next();
  });
  mini.post('/h/:householdId/things', idempotent(ENDPOINT), handler);
  mini.use(errorMiddleware);
  return mini;
};

const setup = async (handler: (call: number) => Promise<unknown> | unknown) => {
  const user = await registerTestUser(app);
  let calls = 0;
  const mini = buildMiniApp(
    asyncHandler(async (_req, res) => {
      calls += 1;
      const result = await handler(calls);
      res.status(201).json({ call: calls, result });
    }),
  );
  const post = (key: string, householdId: string, body: object = { amount: '1.00' }) =>
    request(mini)
      .post(`/h/${householdId}/things`)
      .set('x-test-user', user.id)
      .set('Idempotency-Key', key)
      .send(body);
  return { user, post, calls: () => calls };
};

const hashOf = (body: object): string =>
  createHash('sha256').update(JSON.stringify(body)).digest('hex');

describe('idempotency middleware lifecycle', () => {
  it('rejects a missing, over-long or non-ASCII key with 400', async () => {
    const { user, post } = await setup(() => null);
    const household = randomUUID();

    const missing = await request(buildMiniApp((_req, res) => void res.json({})))
      .post(`/h/${household}/things`)
      .set('x-test-user', user.id)
      .send({})
      .expect(400);
    assert.equal(missing.body.error.code, 'BAD_REQUEST');

    await post('k'.repeat(256), household).expect(400);
    await post('clave-ñandú', household).expect(400);
    await post('k'.repeat(255), household).expect(201);
  });

  it('replays a stored 2xx without running the handler again', async () => {
    const { post, calls } = await setup(() => null);
    const household = randomUUID();
    const key = randomUUID();

    const first = await post(key, household).expect(201);
    const replay = await post(key, household).expect(201);

    assert.deepEqual(replay.body, first.body);
    assert.equal(replay.headers['idempotency-replayed'], 'true');
    assert.equal(first.headers['idempotency-replayed'], undefined);
    assert.equal(calls(), 1);
  });

  it('does not store an error response, so the same key can be retried', async () => {
    const { post, calls } = await setup((call) => {
      if (call === 1) {
        throw new ValidationError('first attempt is invalid');
      }
      return null;
    });
    const household = randomUUID();
    const key = randomUUID();

    await post(key, household).expect(422);
    const retry = await post(key, household).expect(201);
    assert.equal(retry.body.call, 2);

    const replay = await post(key, household).expect(201);
    assert.equal(replay.body.call, 2);
    assert.equal(calls(), 2);
  });

  it('releases the claim when the handler fails unexpectedly', async () => {
    const { post, calls } = await setup((call) => {
      if (call === 1) {
        throw new Error('boom');
      }
      return null;
    });
    const household = randomUUID();
    const key = randomUUID();

    await post(key, household).expect(500);
    await post(key, household).expect(201);
    assert.equal(calls(), 2);
  });

  it('answers 409 IN_PROGRESS with Retry-After while the first request is still running', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered: () => void = () => undefined;
    const handlerEntered = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const { post, calls } = await setup(async (call) => {
      if (call === 1) {
        entered();
        await gate;
      }
      return null;
    });
    const household = randomUUID();
    const key = randomUUID();

    const first = post(key, household).then((res) => res);
    await handlerEntered;

    const concurrent = await post(key, household).expect(409);
    assert.equal(concurrent.body.error.code, 'IDEMPOTENCY_KEY_IN_PROGRESS');
    assert.ok(Number(concurrent.headers['retry-after']) > 0);

    release();
    assert.equal((await first).status, 201);

    // Once the first request has answered, the same key replays its response.
    const replay = await post(key, household).expect(201);
    assert.equal(replay.body.call, 1);
    assert.equal(calls(), 1);
  });

  it('runs the handler exactly once for many simultaneous requests with one key', async () => {
    const { post, calls } = await setup(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return null;
    });
    const household = randomUUID();
    const key = randomUUID();

    const responses = await Promise.all(Array.from({ length: 6 }, () => post(key, household)));

    assert.equal(calls(), 1);
    for (const res of responses) {
      assert.ok([201, 409].includes(res.status), `unexpected status ${res.status}`);
      if (res.status === 409) {
        assert.equal(res.body.error.code, 'IDEMPOTENCY_KEY_IN_PROGRESS');
      }
    }
    assert.ok(responses.some((res) => res.status === 201));
  });

  it('treats a stored response older than 24h as absent', async () => {
    const { user, post, calls } = await setup(() => null);
    const household = randomUUID();
    const key = randomUUID();

    await post(key, household).expect(201);
    await prisma.idempotencyKey.updateMany({
      where: { key, userId: user.id },
      data: { createdAt: new Date(Date.now() - 25 * HOUR_MS) },
    });

    const afterExpiry = await post(key, household).expect(201);
    assert.equal(afterExpiry.body.call, 2);
    assert.equal(afterExpiry.headers['idempotency-replayed'], undefined);
    assert.equal(calls(), 2);
    assert.equal(await prisma.idempotencyKey.count({ where: { key, userId: user.id } }), 1);
  });

  it('does not replay a response across households', async () => {
    const { post, calls } = await setup(() => null);
    const key = randomUUID();

    await post(key, randomUUID()).expect(201);
    const otherHousehold = await post(key, randomUUID()).expect(409);

    assert.equal(otherHousehold.body.error.code, 'IDEMPOTENCY_KEY_CONFLICT');
    assert.equal(calls(), 1);
  });

  it('rejects the same key with a different body', async () => {
    const { post, calls } = await setup(() => null);
    const household = randomUUID();
    const key = randomUUID();

    await post(key, household, { amount: '1.00' }).expect(201);
    const changed = await post(key, household, { amount: '2.00' }).expect(409);

    assert.equal(changed.body.error.code, 'IDEMPOTENCY_KEY_CONFLICT');
    assert.equal(calls(), 1);
  });

  it('takes over a claim abandoned by a crashed request', async () => {
    const { user, post, calls } = await setup(() => null);
    const household = randomUUID();
    const key = randomUUID();
    const body = { amount: '1.00' };
    await prisma.idempotencyKey.create({
      data: {
        key,
        userId: user.id,
        endpoint: `${ENDPOINT} @${household}`,
        requestHash: hashOf(body),
        statusCode: 0,
        responseBody: '',
        createdAt: new Date(Date.now() - 5 * 60 * 1000),
      },
    });

    await post(key, household, body).expect(201);
    assert.equal(calls(), 1);
  });

  it('ignores an error response stored by an older version of the middleware', async () => {
    const { user, post, calls } = await setup(() => null);
    const household = randomUUID();
    const key = randomUUID();
    const body = { amount: '1.00' };
    await prisma.idempotencyKey.create({
      data: {
        key,
        userId: user.id,
        endpoint: `${ENDPOINT} @${household}`,
        requestHash: hashOf(body),
        statusCode: 422,
        responseBody: JSON.stringify({ error: { code: 'VALIDATION_ERROR' } }),
      },
    });

    await post(key, household, body).expect(201);
    assert.equal(calls(), 1);
  });

  it('keeps unrelated errors out of the way: a ConflictError from the handler is not stored', async () => {
    const { post } = await setup((call) => {
      if (call === 1) {
        throw new ConflictError('lost a race');
      }
      return null;
    });
    const household = randomUUID();
    const key = randomUUID();

    await post(key, household).expect(409);
    await post(key, household).expect(201);
  });
});
