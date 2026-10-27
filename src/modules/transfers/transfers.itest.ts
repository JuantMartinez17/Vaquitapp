import { randomUUID } from 'node:crypto';
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from '../../app/app.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { registerTestUser, createTestHousehold, addTestMember } from '../../shared/testing/http.js';

after(async () => {
  await prisma.$disconnect();
});

const authed = (token: string) => (req: request.Test) =>
  req.set('Authorization', `Bearer ${token}`).set('Idempotency-Key', randomUUID());

describe('transfers', () => {
  it('rejects an unauthenticated request', async () => {
    await request(app)
      .get('/api/v1/households/00000000-0000-0000-0000-000000000000/transfers')
      .expect(401);
  });

  it('creates, lists, and voids a transfer between two members', async () => {
    const admin = await registerTestUser(app);
    const householdId = await createTestHousehold(app, admin);
    const member = await addTestMember(app, admin, householdId);

    const created = await authed(admin.accessToken)(
      request(app).post(`/api/v1/households/${householdId}/transfers`),
    )
      .send({
        fromUser: admin.id,
        toUser: member.id,
        amount: '200000.00',
        currencyCode: 'ARS',
        transferDate: '2026-01-01',
      })
      .expect(201);
    assert.equal(created.body.voided, false);

    const list = await authed(admin.accessToken)(
      request(app).get(`/api/v1/households/${householdId}/transfers`),
    ).expect(200);
    assert.equal(list.body.data.length, 1);

    await authed(admin.accessToken)(
      request(app).delete(`/api/v1/households/${householdId}/transfers/${created.body.id}`),
    ).expect(204);

    await authed(admin.accessToken)(
      request(app).delete(`/api/v1/households/${householdId}/transfers/${created.body.id}`),
    )
      .expect(409)
      .expect((res) => assert.equal(res.body.error.code, 'TRANSFER_ALREADY_VOIDED'));
  });

  it('rejects fromUser == toUser and a non-party requester', async () => {
    const admin = await registerTestUser(app);
    const householdId = await createTestHousehold(app, admin);
    const member = await addTestMember(app, admin, householdId);
    const bystander = await addTestMember(app, admin, householdId);

    const same = await authed(admin.accessToken)(
      request(app).post(`/api/v1/households/${householdId}/transfers`),
    )
      .send({
        fromUser: admin.id,
        toUser: admin.id,
        amount: '10.00',
        currencyCode: 'ARS',
        transferDate: '2026-01-01',
      })
      .expect(422);
    assert.equal(same.body.error.code, 'INVALID_TRANSFER');

    await authed(bystander.accessToken)(
      request(app).post(`/api/v1/households/${householdId}/transfers`),
    )
      .send({
        fromUser: admin.id,
        toUser: member.id,
        amount: '10.00',
        currencyCode: 'ARS',
        transferDate: '2026-01-01',
      })
      .expect(403);
  });

  it('does not affect household balances', async () => {
    const admin = await registerTestUser(app);
    const householdId = await createTestHousehold(app, admin);
    const member = await addTestMember(app, admin, householdId);

    await authed(admin.accessToken)(
      request(app).post(`/api/v1/households/${householdId}/transfers`),
    )
      .send({
        fromUser: admin.id,
        toUser: member.id,
        amount: '50000.00',
        currencyCode: 'ARS',
        transferDate: '2026-01-01',
      })
      .expect(201);

    const balances = await authed(admin.accessToken)(
      request(app).get(`/api/v1/households/${householdId}/balances`),
    ).expect(200);
    for (const balance of balances.body.balances) {
      assert.equal(balance.net, '0.00');
    }
  });

  it('requires an Idempotency-Key when recording a transfer', async () => {
    const admin = await registerTestUser(app);
    const householdId = await createTestHousehold(app, admin);
    const member = await addTestMember(app, admin, householdId);

    await request(app)
      .post(`/api/v1/households/${householdId}/transfers`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({
        fromUser: admin.id,
        toUser: member.id,
        amount: '10.00',
        currencyCode: 'ARS',
        transferDate: '2026-01-01',
      })
      .expect(400);
  });

  it('records a retried or concurrent transfer once per Idempotency-Key', async () => {
    const admin = await registerTestUser(app);
    const householdId = await createTestHousehold(app, admin);
    const member = await addTestMember(app, admin, householdId);
    const key = randomUUID();
    const send = () =>
      request(app)
        .post(`/api/v1/households/${householdId}/transfers`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .set('Idempotency-Key', key)
        .send({
          fromUser: admin.id,
          toUser: member.id,
          amount: '75.00',
          currencyCode: 'ARS',
          transferDate: '2026-01-01',
        });

    const responses = await Promise.all([send(), send(), send()]);
    for (const res of responses) {
      assert.ok([201, 409].includes(res.status), `unexpected status ${res.status}`);
    }
    assert.ok(responses.some((res) => res.status === 201));

    const replay = await send().expect(201);
    const created = responses.find((res) => res.status === 201);
    assert.equal(replay.body.id, created?.body.id);

    const list = await authed(admin.accessToken)(
      request(app).get(`/api/v1/households/${householdId}/transfers`),
    ).expect(200);
    assert.equal(list.body.data.length, 1);
  });
});
