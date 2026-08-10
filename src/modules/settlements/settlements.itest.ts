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

describe('settlements', () => {
  it('rejects an unauthenticated request', async () => {
    await request(app)
      .get('/api/v1/households/00000000-0000-0000-0000-000000000000/settlements')
      .expect(401);
  });

  it('lets a party record a settlement, and rejects a third party doing it', async () => {
    const admin = await registerTestUser(app);
    const outsider = await registerTestUser(app);
    const householdId = await createTestHousehold(app, admin);
    const joined = await addTestMember(app, admin, householdId);
    const bystander = await addTestMember(app, admin, householdId);

    // joined is a party (fromUser), so this clears the "must be a party"
    // check and reaches the "toUser must be an active member" check.
    const byOutsider = await authed(joined.accessToken)(
      request(app).post(`/api/v1/households/${householdId}/settlements`),
    )
      .send({
        fromUser: joined.id,
        toUser: outsider.id,
        amount: '10.00',
        currencyCode: 'ARS',
        settlementDate: '2026-01-01',
      })
      .expect(422);
    assert.equal(byOutsider.body.error.code, 'INVALID_SETTLEMENT');

    // bystander is an active household member, but not a party to this
    // settlement, so they can't record it on the others' behalf.
    const forbidden = await authed(bystander.accessToken)(
      request(app).post(`/api/v1/households/${householdId}/settlements`),
    )
      .send({
        fromUser: admin.id,
        toUser: joined.id,
        amount: '10.00',
        currencyCode: 'ARS',
        settlementDate: '2026-01-01',
      })
      .expect(403);
    assert.ok(forbidden.body.error);

    const sameUser = await authed(admin.accessToken)(
      request(app).post(`/api/v1/households/${householdId}/settlements`),
    )
      .send({
        fromUser: admin.id,
        toUser: admin.id,
        amount: '10.00',
        currencyCode: 'ARS',
        settlementDate: '2026-01-01',
      })
      .expect(422);
    assert.equal(sameUser.body.error.code, 'INVALID_SETTLEMENT');

    const created = await authed(admin.accessToken)(
      request(app).post(`/api/v1/households/${householdId}/settlements`),
    )
      .send({
        fromUser: joined.id,
        toUser: admin.id,
        amount: '10.00',
        currencyCode: 'ARS',
        settlementDate: '2026-01-01',
      })
      .expect(201);
    assert.equal(created.body.status, 'confirmed');
    assert.equal(created.body.amount, '10.00');
  });

  it('voids a settlement and rejects voiding it twice', async () => {
    const admin = await registerTestUser(app);
    const householdId = await createTestHousehold(app, admin);
    const member = await addTestMember(app, admin, householdId);

    const created = await authed(admin.accessToken)(
      request(app).post(`/api/v1/households/${householdId}/settlements`),
    )
      .send({
        fromUser: member.id,
        toUser: admin.id,
        amount: '15.00',
        currencyCode: 'ARS',
        settlementDate: '2026-01-01',
      })
      .expect(201);

    await authed(admin.accessToken)(
      request(app).delete(`/api/v1/households/${householdId}/settlements/${created.body.id}`),
    ).expect(204);

    await authed(admin.accessToken)(
      request(app).delete(`/api/v1/households/${householdId}/settlements/${created.body.id}`),
    )
      .expect(409)
      .expect((res) => assert.equal(res.body.error.code, 'SETTLEMENT_ALREADY_VOIDED'));
  });
});
