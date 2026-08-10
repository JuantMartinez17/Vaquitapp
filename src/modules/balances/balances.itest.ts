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

describe('balances', () => {
  it('rejects an unauthenticated request', async () => {
    await request(app)
      .get('/api/v1/households/00000000-0000-0000-0000-000000000000/balances')
      .expect(401);
  });

  it('rejects a non-member', async () => {
    const admin = await registerTestUser(app);
    const outsider = await registerTestUser(app);
    const householdId = await createTestHousehold(app, admin);

    await authed(outsider.accessToken)(
      request(app).get(`/api/v1/households/${householdId}/balances`),
    ).expect(403);
  });

  it('derives balances from expenses, simplifies the debt, and a matching settlement zeroes it', async () => {
    const juan = await registerTestUser(app);
    const householdId = await createTestHousehold(app, juan);
    const maria = await addTestMember(app, juan, householdId);

    // Juan pays $100 supermarket, split evenly.
    await authed(juan.accessToken)(request(app).post(`/api/v1/households/${householdId}/expenses`))
      .send({
        description: 'Supermercado',
        amount: '100.00',
        currencyCode: 'ARS',
        expenseDate: '2026-01-01',
        paidBy: juan.id,
        splitType: 'equal',
        participants: [{ userId: juan.id }, { userId: maria.id }],
      })
      .expect(201);

    // Maria pays $40 electricity, split evenly.
    await authed(maria.accessToken)(request(app).post(`/api/v1/households/${householdId}/expenses`))
      .send({
        description: 'Luz',
        amount: '40.00',
        currencyCode: 'ARS',
        expenseDate: '2026-01-02',
        paidBy: maria.id,
        splitType: 'equal',
        participants: [{ userId: juan.id }, { userId: maria.id }],
      })
      .expect(201);

    const balances = await authed(juan.accessToken)(
      request(app).get(`/api/v1/households/${householdId}/balances`),
    ).expect(200);
    assert.equal(balances.body.currencyCode, 'ARS');
    const juanBalance = balances.body.balances.find(
      (b: { userId: string }) => b.userId === juan.id,
    );
    const mariaBalance = balances.body.balances.find(
      (b: { userId: string }) => b.userId === maria.id,
    );
    assert.equal(juanBalance.net, '30.00');
    assert.equal(mariaBalance.net, '-30.00');

    const simplified = await authed(juan.accessToken)(
      request(app).get(`/api/v1/households/${householdId}/balances/simplified`),
    ).expect(200);
    assert.equal(simplified.body.simplified.length, 1);
    assert.equal(simplified.body.simplified[0].from, maria.id);
    assert.equal(simplified.body.simplified[0].to, juan.id);
    assert.equal(simplified.body.simplified[0].amount, '30.00');

    // Maria settles the exact simplified amount.
    await authed(maria.accessToken)(
      request(app).post(`/api/v1/households/${householdId}/settlements`),
    )
      .send({
        fromUser: maria.id,
        toUser: juan.id,
        amount: '30.00',
        currencyCode: 'ARS',
        settlementDate: '2026-01-03',
      })
      .expect(201);

    const afterSettlement = await authed(juan.accessToken)(
      request(app).get(`/api/v1/households/${householdId}/balances`),
    ).expect(200);
    for (const balance of afterSettlement.body.balances) {
      assert.equal(balance.net, '0.00');
    }
  });

  it('excludes a voided expense from the balance calculation', async () => {
    const admin = await registerTestUser(app);
    const householdId = await createTestHousehold(app, admin);
    const member = await addTestMember(app, admin, householdId);

    const expense = await authed(admin.accessToken)(
      request(app).post(`/api/v1/households/${householdId}/expenses`),
    )
      .send({
        description: 'Gimnasio',
        amount: '50.00',
        currencyCode: 'ARS',
        expenseDate: '2026-01-01',
        paidBy: admin.id,
        splitType: 'equal',
        participants: [{ userId: admin.id }, { userId: member.id }],
      })
      .expect(201);

    await authed(admin.accessToken)(
      request(app).delete(`/api/v1/households/${householdId}/expenses/${expense.body.id}`),
    ).expect(204);

    const balances = await authed(admin.accessToken)(
      request(app).get(`/api/v1/households/${householdId}/balances`),
    ).expect(200);
    for (const balance of balances.body.balances) {
      assert.equal(balance.net, '0.00');
    }
  });
});
