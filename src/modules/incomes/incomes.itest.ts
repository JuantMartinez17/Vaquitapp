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

// Every POST below goes through a route requiring `Idempotency-Key` (D12);
// setting it here for all verbs is simpler than threading it per call site.
const authed = (token: string) => (req: request.Test) =>
  req.set('Authorization', `Bearer ${token}`).set('Idempotency-Key', randomUUID());

describe('incomes', () => {
  it('rejects an unauthenticated request', async () => {
    await request(app)
      .get('/api/v1/households/00000000-0000-0000-0000-000000000000/incomes')
      .expect(401);
  });

  it('creates, edits, lists, and voids an income', async () => {
    const admin = await registerTestUser(app);
    const householdId = await createTestHousehold(app, admin);

    const created = await authed(admin.accessToken)(
      request(app).post(`/api/v1/households/${householdId}/incomes`),
    )
      .send({
        receivedBy: admin.id,
        description: 'Sueldo',
        amount: '500000.00',
        currencyCode: 'ARS',
        incomeDate: '2026-01-01',
      })
      .expect(201);
    assert.equal(created.body.amount, '500000.00');
    assert.equal(created.body.voided, false);

    const edited = await authed(admin.accessToken)(
      request(app).patch(`/api/v1/households/${householdId}/incomes/${created.body.id}`),
    )
      .send({ amount: '520000.00', description: 'Sueldo + bono' })
      .expect(200);
    assert.equal(edited.body.amount, '520000.00');
    assert.equal(edited.body.description, 'Sueldo + bono');

    const list = await authed(admin.accessToken)(
      request(app).get(`/api/v1/households/${householdId}/incomes`),
    ).expect(200);
    assert.equal(list.body.data.length, 1);

    await authed(admin.accessToken)(
      request(app).delete(`/api/v1/households/${householdId}/incomes/${created.body.id}`),
    ).expect(204);

    await authed(admin.accessToken)(
      request(app).delete(`/api/v1/households/${householdId}/incomes/${created.body.id}`),
    )
      .expect(409)
      .expect((res) => assert.equal(res.body.error.code, 'INCOME_ALREADY_VOIDED'));

    const afterVoid = await authed(admin.accessToken)(
      request(app).get(`/api/v1/households/${householdId}/incomes`),
    ).expect(200);
    assert.equal(afterVoid.body.data.length, 0);
  });

  it('rejects a receivedBy who is not an active member', async () => {
    const admin = await registerTestUser(app);
    const outsider = await registerTestUser(app);
    const householdId = await createTestHousehold(app, admin);

    const res = await authed(admin.accessToken)(
      request(app).post(`/api/v1/households/${householdId}/incomes`),
    )
      .send({
        receivedBy: outsider.id,
        description: 'x',
        amount: '10.00',
        currencyCode: 'ARS',
        incomeDate: '2026-01-01',
      })
      .expect(422);
    assert.equal(res.body.error.code, 'NOT_A_MEMBER');
  });

  it('does not affect household balances', async () => {
    const admin = await registerTestUser(app);
    const householdId = await createTestHousehold(app, admin);
    await addTestMember(app, admin, householdId);

    await authed(admin.accessToken)(request(app).post(`/api/v1/households/${householdId}/incomes`))
      .send({
        receivedBy: admin.id,
        description: 'Reintegro',
        amount: '99999.00',
        currencyCode: 'ARS',
        incomeDate: '2026-01-01',
      })
      .expect(201);

    const balances = await authed(admin.accessToken)(
      request(app).get(`/api/v1/households/${householdId}/balances`),
    ).expect(200);
    for (const balance of balances.body.balances) {
      assert.equal(balance.net, '0.00');
    }
  });
});
