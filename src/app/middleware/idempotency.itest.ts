import { randomUUID } from 'node:crypto';
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from '../app.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { registerTestUser, createTestHousehold } from '../../shared/testing/http.js';

after(async () => {
  await prisma.$disconnect();
});

const authed = (token: string) => (req: request.Test) =>
  req.set('Authorization', `Bearer ${token}`);

const expensePayload = (userId: string, overrides: Record<string, unknown> = {}) => ({
  description: 'Idempotency test',
  amount: '10.00',
  currencyCode: 'ARS',
  expenseDate: '2026-01-01',
  paidBy: userId,
  splitType: 'equal',
  participants: [{ userId }],
  ...overrides,
});

describe('idempotency middleware (D12)', () => {
  it('rejects a financial POST with no Idempotency-Key header', async () => {
    const admin = await registerTestUser(app);
    const householdId = await createTestHousehold(app, admin);

    const res = await authed(admin.accessToken)(
      request(app).post(`/api/v1/households/${householdId}/expenses`),
    )
      .send(expensePayload(admin.id))
      .expect(400);
    assert.equal(res.body.error.code, 'BAD_REQUEST');
  });

  it('replays the original response instead of creating a duplicate', async () => {
    const admin = await registerTestUser(app);
    const householdId = await createTestHousehold(app, admin);
    const key = randomUUID();
    const payload = expensePayload(admin.id);

    const first = await authed(admin.accessToken)(
      request(app).post(`/api/v1/households/${householdId}/expenses`),
    )
      .set('Idempotency-Key', key)
      .send(payload)
      .expect(201);

    const replay = await authed(admin.accessToken)(
      request(app).post(`/api/v1/households/${householdId}/expenses`),
    )
      .set('Idempotency-Key', key)
      .send(payload)
      .expect(201);
    assert.equal(replay.body.id, first.body.id);

    const list = await authed(admin.accessToken)(
      request(app).get(`/api/v1/households/${householdId}/expenses`),
    ).expect(200);
    assert.equal(list.body.data.length, 1);
  });

  it('rejects replaying the same key with a different request body', async () => {
    const admin = await registerTestUser(app);
    const householdId = await createTestHousehold(app, admin);
    const key = randomUUID();

    await authed(admin.accessToken)(request(app).post(`/api/v1/households/${householdId}/expenses`))
      .set('Idempotency-Key', key)
      .send(expensePayload(admin.id))
      .expect(201);

    const conflict = await authed(admin.accessToken)(
      request(app).post(`/api/v1/households/${householdId}/expenses`),
    )
      .set('Idempotency-Key', key)
      .send(expensePayload(admin.id, { amount: '99.00' }))
      .expect(409);
    assert.equal(conflict.body.error.code, 'IDEMPOTENCY_KEY_CONFLICT');
  });

  it('scopes keys per user, so two users can reuse the same key independently', async () => {
    const admin = await registerTestUser(app);
    const other = await registerTestUser(app);
    const householdId = await createTestHousehold(app, admin);
    const otherHouseholdId = await createTestHousehold(app, other);
    const key = randomUUID();

    const a = await authed(admin.accessToken)(
      request(app).post(`/api/v1/households/${householdId}/expenses`),
    )
      .set('Idempotency-Key', key)
      .send(expensePayload(admin.id))
      .expect(201);

    const b = await authed(other.accessToken)(
      request(app).post(`/api/v1/households/${otherHouseholdId}/expenses`),
    )
      .set('Idempotency-Key', key)
      .send(expensePayload(other.id))
      .expect(201);

    assert.notEqual(a.body.id, b.body.id);
  });
});
