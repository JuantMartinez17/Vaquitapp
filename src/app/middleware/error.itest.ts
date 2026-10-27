import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { z } from 'zod';
import { app } from '../app.js';
import { errorMiddleware } from './error.middleware.js';
import { validate } from './validate.middleware.js';
import { asyncHandler } from '../../shared/utils/asyncHandler.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { PrismaClient } from '../../generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { env } from '../config.js';
import { registerTestUser } from '../../shared/testing/http.js';
import { ServiceUnavailableError } from '../../shared/errors/errors.js';

after(async () => {
  await prisma.$disconnect();
});

// A tiny app wired with the real error middleware, whose single route runs
// `action`. It lets each test provoke a specific failure mode on demand.
const probeApp = (action: () => Promise<unknown>) => {
  const probe = express();
  probe.get(
    '/probe',
    asyncHandler(async () => {
      await action();
    }),
  );
  probe.use(errorMiddleware);
  return probe;
};

describe('error middleware: request body parsing', () => {
  it('answers 400 BAD_REQUEST for malformed JSON instead of 500', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email": ')
      .expect(400);
    assert.equal(res.body.error.code, 'BAD_REQUEST');
    assert.doesNotMatch(JSON.stringify(res.body), /Unexpected|position|at /);
  });

  it('answers 413 PAYLOAD_TOO_LARGE when the JSON body exceeds the limit', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ filler: 'x'.repeat(1024 * 1024 + 10) }))
      .expect(413);
    assert.equal(res.body.error.code, 'PAYLOAD_TOO_LARGE');
  });
});

describe('error middleware: validation', () => {
  it('reports root-level issues (unknown keys) next to the field errors', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'not-an-email', password: 'x', surprise: true })
      .expect(422);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    assert.ok(res.body.error.details.email, 'field errors are still present');
    assert.ok(
      Array.isArray(res.body.error.details.formErrors) &&
        res.body.error.details.formErrors.length > 0,
      'root-level messages are included',
    );
  });

  it('keeps the plain per-field shape when there are no root-level issues', async () => {
    const probe = express();
    probe.use(express.json());
    probe.post('/probe', validate({ body: z.object({ name: z.string() }) }), (_req, res) => {
      res.end();
    });
    probe.use(errorMiddleware);
    const res = await request(probe).post('/probe').send({ name: 1 }).expect(422);
    assert.deepEqual(Object.keys(res.body.error.details), ['name']);
  });
});

describe('error middleware: Prisma errors', () => {
  it('maps a unique-constraint violation (P2002) to 409 CONFLICT', async () => {
    const user = await registerTestUser(app);
    const res = await request(
      probeApp(async () => {
        await prisma.user.create({
          data: {
            email: user.email,
            username: `dup_${Date.now()}`,
            passwordHash: 'x',
            displayName: 'dup',
          },
        });
      }),
    )
      .get('/probe')
      .expect(409);
    assert.equal(res.body.error.code, 'CONFLICT');
    assert.doesNotMatch(JSON.stringify(res.body), /users_email_key|Invalid `prisma/);
  });

  it('maps a missing record (P2025) to 404 NOT_FOUND', async () => {
    const res = await request(
      probeApp(async () => {
        await prisma.user.update({
          where: { id: '00000000-0000-0000-0000-000000000000' },
          data: { displayName: 'ghost' },
        });
      }),
    )
      .get('/probe')
      .expect(404);
    assert.equal(res.body.error.code, 'NOT_FOUND');
  });

  it('maps an unreachable database to 503 SERVICE_UNAVAILABLE with Retry-After', async () => {
    const dead = new PrismaClient({
      adapter: new PrismaPg({
        connectionString: env.DATABASE_URL.replace(':5432', ':5999'),
        connectionTimeoutMillis: 1_000,
      }),
    });
    try {
      const res = await request(probeApp(() => dead.user.findFirst()))
        .get('/probe')
        .expect(503);
      assert.equal(res.body.error.code, 'SERVICE_UNAVAILABLE');
      assert.equal(res.headers['retry-after'], '5');
    } finally {
      await dead.$disconnect().catch(() => undefined);
    }
  });

  it('maps connection-pool exhaustion (pool timeout) to 503 SERVICE_UNAVAILABLE', async () => {
    const small = new PrismaClient({
      adapter: new PrismaPg({
        connectionString: env.DATABASE_URL,
        max: 1,
        connectionTimeoutMillis: 200,
      }),
    });
    try {
      await small.$queryRaw`SELECT 1`;
      // Holds the pool's only connection for longer than the timeout above.
      const holder = small.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT pg_sleep(1)::text`;
        },
        { timeout: 5_000 },
      );
      await new Promise((resolve) => setTimeout(resolve, 100));

      const res = await request(probeApp(() => small.user.findFirst()))
        .get('/probe')
        .expect(503);
      assert.equal(res.body.error.code, 'SERVICE_UNAVAILABLE');
      await holder;
    } finally {
      await small.$disconnect();
    }
  });
});

describe('error middleware: guard rails', () => {
  it('never leaks the message or stack of an unexpected error', async () => {
    const res = await request(probeApp(() => Promise.reject(new Error('secret internal detail'))))
      .get('/probe')
      .expect(500);
    assert.equal(res.body.error.code, 'INTERNAL_ERROR');
    assert.doesNotMatch(JSON.stringify(res.body), /secret internal detail|\.ts:/);
  });

  it('advertises Retry-After for a ServiceUnavailableError that carries one', async () => {
    const res = await request(
      probeApp(() =>
        Promise.reject(new ServiceUnavailableError('busy', 'UPLOAD_CAPACITY_EXCEEDED', 3)),
      ),
    )
      .get('/probe')
      .expect(503);
    assert.equal(res.headers['retry-after'], '3');
    assert.equal(res.body.error.code, 'UPLOAD_CAPACITY_EXCEEDED');
  });

  it('delegates to Express instead of writing JSON once headers were sent', () => {
    const error = new Error('late failure');
    let delegated: unknown;
    let wroteBody = false;
    const res = {
      headersSent: true,
      status: () => {
        wroteBody = true;
        return res;
      },
      json: () => {
        wroteBody = true;
      },
    };
    errorMiddleware(
      error,
      { path: '/x' } as never,
      res as never,
      ((e: unknown) => {
        delegated = e;
      }) as never,
    );
    assert.equal(delegated, error);
    assert.equal(wroteBody, false);
  });
});
