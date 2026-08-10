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

describe('analytics', () => {
  it('rejects an unauthenticated request', async () => {
    await request(app)
      .get(
        '/api/v1/households/00000000-0000-0000-0000-000000000000/analytics/summary?from=2026-01-01&to=2026-01-31',
      )
      .expect(401);
  });

  it('rejects a missing or inverted date range', async () => {
    const admin = await registerTestUser(app);
    const householdId = await createTestHousehold(app, admin);

    await authed(admin.accessToken)(
      request(app).get(`/api/v1/households/${householdId}/analytics/summary`),
    ).expect(422);

    await authed(admin.accessToken)(
      request(app).get(
        `/api/v1/households/${householdId}/analytics/summary?from=2026-02-01&to=2026-01-01`,
      ),
    ).expect(422);
  });

  it('rejects a range wider than 366 days', async () => {
    const admin = await registerTestUser(app);
    const householdId = await createTestHousehold(app, admin);

    await authed(admin.accessToken)(
      request(app).get(
        `/api/v1/households/${householdId}/analytics/summary?from=2024-01-01&to=2026-06-01`,
      ),
    ).expect(422);
  });

  it('rejects a non-member', async () => {
    const admin = await registerTestUser(app);
    const outsider = await registerTestUser(app);
    const householdId = await createTestHousehold(app, admin);

    await authed(outsider.accessToken)(
      request(app).get(
        `/api/v1/households/${householdId}/analytics/summary?from=2026-01-01&to=2026-01-31`,
      ),
    ).expect(403);
  });

  it('derives summary, by-category, by-member, over-time and comparison from activity', async () => {
    const admin = await registerTestUser(app);
    const householdId = await createTestHousehold(app, admin);
    const member = await addTestMember(app, admin, householdId);

    const category = await authed(admin.accessToken)(
      request(app).post(`/api/v1/households/${householdId}/categories`),
    )
      .send({ name: 'Comida de prueba' })
      .expect(201);

    // Two expenses inside the analysis window, one outside it.
    await authed(admin.accessToken)(request(app).post(`/api/v1/households/${householdId}/expenses`))
      .send({
        description: 'Super',
        amount: '100.00',
        currencyCode: 'ARS',
        expenseDate: '2026-03-05',
        categoryId: category.body.id,
        paidBy: admin.id,
        splitType: 'equal',
        participants: [{ userId: admin.id }, { userId: member.id }],
      })
      .expect(201);
    await authed(admin.accessToken)(request(app).post(`/api/v1/households/${householdId}/expenses`))
      .send({
        description: 'Super de nuevo',
        amount: '50.00',
        currencyCode: 'ARS',
        expenseDate: '2026-03-10',
        categoryId: category.body.id,
        paidBy: member.id,
        splitType: 'equal',
        participants: [{ userId: admin.id }, { userId: member.id }],
      })
      .expect(201);
    await authed(admin.accessToken)(request(app).post(`/api/v1/households/${householdId}/expenses`))
      .send({
        description: 'Fuera de rango',
        amount: '999.00',
        currencyCode: 'ARS',
        expenseDate: '2026-01-01',
        paidBy: admin.id,
        splitType: 'equal',
        participants: [{ userId: admin.id }],
      })
      .expect(201);

    await authed(admin.accessToken)(request(app).post(`/api/v1/households/${householdId}/incomes`))
      .send({
        receivedBy: admin.id,
        description: 'Sueldo',
        amount: '1000.00',
        currencyCode: 'ARS',
        incomeDate: '2026-03-07',
      })
      .expect(201);

    const range = 'from=2026-03-01&to=2026-03-31';

    const summary = await authed(admin.accessToken)(
      request(app).get(`/api/v1/households/${householdId}/analytics/summary?${range}`),
    ).expect(200);
    assert.equal(summary.body.totalSpent, '150.00');
    assert.equal(summary.body.totalIncome, '1000.00');
    assert.equal(summary.body.net, '850.00');

    const byCategory = await authed(admin.accessToken)(
      request(app).get(`/api/v1/households/${householdId}/analytics/by-category?${range}`),
    ).expect(200);
    assert.equal(byCategory.body.length, 1);
    assert.equal(byCategory.body[0].totalSpent, '150.00');

    const byMember = await authed(admin.accessToken)(
      request(app).get(`/api/v1/households/${householdId}/analytics/by-member?${range}`),
    ).expect(200);
    const adminShare = byMember.body.find((m: { userId: string }) => m.userId === admin.id);
    const memberShare = byMember.body.find((m: { userId: string }) => m.userId === member.id);
    assert.equal(adminShare.totalSpent, '75.00');
    assert.equal(memberShare.totalSpent, '75.00');

    const overTime = await authed(admin.accessToken)(
      request(app).get(
        `/api/v1/households/${householdId}/analytics/over-time?${range}&granularity=day`,
      ),
    ).expect(200);
    assert.equal(overTime.body.length, 2);
    assert.deepEqual(
      overTime.body.map((r: { date: string }) => r.date),
      ['2026-03-05', '2026-03-10'],
    );

    const comparison = await authed(admin.accessToken)(
      request(app).get(`/api/v1/households/${householdId}/analytics/comparison?${range}`),
    ).expect(200);
    assert.equal(comparison.body.current.totalSpent, '150.00');
    // The previous 31-day period (2026-01-29 .. 2026-02-28) includes none of
    // the fixtures above.
    assert.equal(comparison.body.previous.totalSpent, '0.00');
  });
});
