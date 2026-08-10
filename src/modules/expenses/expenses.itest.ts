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

describe('expenses', () => {
  it('rejects an unauthenticated request', async () => {
    await request(app)
      .get('/api/v1/households/00000000-0000-0000-0000-000000000000/expenses')
      .expect(401);
  });

  it('creates an equal split across three participants (100/3) summing exactly', async () => {
    const admin = await registerTestUser(app);
    const householdId = await createTestHousehold(app, admin);
    const b = await addTestMember(app, admin, householdId);
    const c = await addTestMember(app, admin, householdId);

    const res = await authed(admin.accessToken)(
      request(app).post(`/api/v1/households/${householdId}/expenses`),
    )
      .send({
        description: 'Supermercado',
        amount: '100.00',
        currencyCode: 'ARS',
        expenseDate: '2026-01-15',
        paidBy: admin.id,
        splitType: 'equal',
        participants: [{ userId: admin.id }, { userId: b.id }, { userId: c.id }],
      })
      .expect(201);

    assert.equal(res.body.status, 'active');
    assert.equal(res.body.splits.length, 3);
    const total = res.body.splits.reduce(
      (sum: number, s: { amount: string }) => sum + Number(s.amount),
      0,
    );
    assert.equal(total.toFixed(2), '100.00');
  });

  it('creates a personal expense (single participant) with no debt implication', async () => {
    const admin = await registerTestUser(app);
    const householdId = await createTestHousehold(app, admin);

    const res = await authed(admin.accessToken)(
      request(app).post(`/api/v1/households/${householdId}/expenses`),
    )
      .send({
        description: 'Auriculares',
        amount: '25000.00',
        currencyCode: 'ARS',
        expenseDate: '2026-01-15',
        paidBy: admin.id,
        splitType: 'equal',
        participants: [{ userId: admin.id }],
      })
      .expect(201);

    assert.equal(res.body.splits.length, 1);
    assert.equal(res.body.splits[0].amount, '25000.00');
  });

  it('accepts a matching exact split and rejects a mismatched one', async () => {
    const admin = await registerTestUser(app);
    const householdId = await createTestHousehold(app, admin);
    const b = await addTestMember(app, admin, householdId);

    await authed(admin.accessToken)(request(app).post(`/api/v1/households/${householdId}/expenses`))
      .send({
        description: 'Alquiler',
        amount: '100.00',
        currencyCode: 'ARS',
        expenseDate: '2026-01-01',
        paidBy: admin.id,
        splitType: 'exact',
        participants: [
          { userId: admin.id, amount: '40.00' },
          { userId: b.id, amount: '60.00' },
        ],
      })
      .expect(201);

    const mismatch = await authed(admin.accessToken)(
      request(app).post(`/api/v1/households/${householdId}/expenses`),
    )
      .send({
        description: 'Alquiler mal',
        amount: '100.00',
        currencyCode: 'ARS',
        expenseDate: '2026-01-01',
        paidBy: admin.id,
        splitType: 'exact',
        participants: [
          { userId: admin.id, amount: '40.00' },
          { userId: b.id, amount: '59.99' },
        ],
      })
      .expect(422);
    assert.equal(mismatch.body.error.code, 'INVALID_EXPENSE_SPLIT');
    assert.equal(mismatch.body.error.details.expected, '100.00');
    assert.equal(mismatch.body.error.details.received, '99.99');
  });

  it('splits by percentage and by shares', async () => {
    const admin = await registerTestUser(app);
    const householdId = await createTestHousehold(app, admin);
    const b = await addTestMember(app, admin, householdId);

    const pct = await authed(admin.accessToken)(
      request(app).post(`/api/v1/households/${householdId}/expenses`),
    )
      .send({
        description: 'Internet',
        amount: '100.00',
        currencyCode: 'ARS',
        expenseDate: '2026-01-01',
        paidBy: admin.id,
        splitType: 'percentage',
        participants: [
          { userId: admin.id, percentage: 70 },
          { userId: b.id, percentage: 30 },
        ],
      })
      .expect(201);
    assert.equal(
      pct.body.splits.find((s: { userId: string }) => s.userId === admin.id).amount,
      '70.00',
    );

    const shares = await authed(admin.accessToken)(
      request(app).post(`/api/v1/households/${householdId}/expenses`),
    )
      .send({
        description: 'Vacaciones',
        amount: '100.00',
        currencyCode: 'ARS',
        expenseDate: '2026-01-01',
        paidBy: admin.id,
        splitType: 'shares',
        participants: [
          { userId: admin.id, shares: 3 },
          { userId: b.id, shares: 1 },
        ],
      })
      .expect(201);
    assert.equal(
      shares.body.splits.find((s: { userId: string }) => s.userId === admin.id).amount,
      '75.00',
    );
  });

  it('rejects a payer or participant who is not an active household member', async () => {
    const admin = await registerTestUser(app);
    const outsider = await registerTestUser(app);
    const householdId = await createTestHousehold(app, admin);

    const badPayer = await authed(admin.accessToken)(
      request(app).post(`/api/v1/households/${householdId}/expenses`),
    )
      .send({
        description: 'x',
        amount: '10.00',
        currencyCode: 'ARS',
        expenseDate: '2026-01-01',
        paidBy: outsider.id,
        splitType: 'equal',
        participants: [{ userId: admin.id }],
      })
      .expect(422);
    assert.equal(badPayer.body.error.code, 'INVALID_PAYER');

    const badParticipant = await authed(admin.accessToken)(
      request(app).post(`/api/v1/households/${householdId}/expenses`),
    )
      .send({
        description: 'x',
        amount: '10.00',
        currencyCode: 'ARS',
        expenseDate: '2026-01-01',
        paidBy: admin.id,
        splitType: 'equal',
        participants: [{ userId: admin.id }, { userId: outsider.id }],
      })
      .expect(422);
    assert.equal(badParticipant.body.error.code, 'INVALID_PARTICIPANT');
  });

  it('rejects a category from another household and a currency mismatch', async () => {
    const admin = await registerTestUser(app);
    const householdId = await createTestHousehold(app, admin);
    const otherHouseholdId = await createTestHousehold(app, admin, 'Other');
    const otherCategory = await authed(admin.accessToken)(
      request(app).post(`/api/v1/households/${otherHouseholdId}/categories`),
    )
      .send({ name: 'Solo del otro hogar' })
      .expect(201);

    const badCategory = await authed(admin.accessToken)(
      request(app).post(`/api/v1/households/${householdId}/expenses`),
    )
      .send({
        description: 'x',
        amount: '10.00',
        currencyCode: 'ARS',
        expenseDate: '2026-01-01',
        categoryId: otherCategory.body.id,
        paidBy: admin.id,
        splitType: 'equal',
        participants: [{ userId: admin.id }],
      })
      .expect(422);
    assert.equal(badCategory.body.error.code, 'INVALID_CATEGORY');

    const badCurrency = await authed(admin.accessToken)(
      request(app).post(`/api/v1/households/${householdId}/expenses`),
    )
      .send({
        description: 'x',
        amount: '10.00',
        currencyCode: 'USD',
        expenseDate: '2026-01-01',
        paidBy: admin.id,
        splitType: 'equal',
        participants: [{ userId: admin.id }],
      })
      .expect(422);
    assert.equal(badCurrency.body.error.code, 'INVALID_CURRENCY');
  });

  it('voids an expense, rejects double-void, and edit recalculates splits', async () => {
    const admin = await registerTestUser(app);
    const householdId = await createTestHousehold(app, admin);
    const b = await addTestMember(app, admin, householdId);

    const created = await authed(admin.accessToken)(
      request(app).post(`/api/v1/households/${householdId}/expenses`),
    )
      .send({
        description: 'Luz',
        amount: '100.00',
        currencyCode: 'ARS',
        expenseDate: '2026-01-01',
        paidBy: admin.id,
        splitType: 'equal',
        participants: [{ userId: admin.id }, { userId: b.id }],
      })
      .expect(201);

    const edited = await authed(admin.accessToken)(
      request(app).patch(`/api/v1/households/${householdId}/expenses/${created.body.id}`),
    )
      .send({
        amount: '150.00',
        splitType: 'exact',
        participants: [
          { userId: admin.id, amount: '100.00' },
          { userId: b.id, amount: '50.00' },
        ],
      })
      .expect(200);
    assert.equal(edited.body.amount, '150.00');
    assert.equal(edited.body.splits.length, 2);
    assert.equal(
      edited.body.splits.find((s: { userId: string }) => s.userId === admin.id).amount,
      '100.00',
    );

    // A metadata-only edit must not touch the splits.
    const metaEdit = await authed(admin.accessToken)(
      request(app).patch(`/api/v1/households/${householdId}/expenses/${created.body.id}`),
    )
      .send({ description: 'Luz y gas' })
      .expect(200);
    assert.equal(metaEdit.body.description, 'Luz y gas');
    assert.equal(metaEdit.body.amount, '150.00');
    assert.equal(metaEdit.body.splits.length, 2);

    await authed(admin.accessToken)(
      request(app).delete(`/api/v1/households/${householdId}/expenses/${created.body.id}`),
    ).expect(204);

    await authed(admin.accessToken)(
      request(app).delete(`/api/v1/households/${householdId}/expenses/${created.body.id}`),
    )
      .expect(409)
      .expect((res) => assert.equal(res.body.error.code, 'EXPENSE_ALREADY_VOIDED'));

    // Voided expenses are excluded from the default (active-only) listing...
    const active = await authed(admin.accessToken)(
      request(app).get(`/api/v1/households/${householdId}/expenses`),
    ).expect(200);
    assert.ok(!active.body.data.some((e: { id: string }) => e.id === created.body.id));

    // ...but still readable directly by id, and visible with an explicit status filter.
    const direct = await authed(admin.accessToken)(
      request(app).get(`/api/v1/households/${householdId}/expenses/${created.body.id}`),
    ).expect(200);
    assert.equal(direct.body.status, 'voided');

    const voidedList = await authed(admin.accessToken)(
      request(app).get(`/api/v1/households/${householdId}/expenses?status=voided`),
    ).expect(200);
    assert.ok(voidedList.body.data.some((e: { id: string }) => e.id === created.body.id));
  });

  it('rejects listing and reading for a non-member', async () => {
    const admin = await registerTestUser(app);
    const outsider = await registerTestUser(app);
    const householdId = await createTestHousehold(app, admin);

    await authed(outsider.accessToken)(
      request(app).get(`/api/v1/households/${householdId}/expenses`),
    ).expect(403);
  });
});
