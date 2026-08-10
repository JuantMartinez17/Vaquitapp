import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from '../../app/app.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { registerTestUser, createTestHousehold, addTestMember } from '../../shared/testing/http.js';
import { generateDueOccurrences } from './recurring-expenses.service.js';

after(async () => {
  await prisma.$disconnect();
});

const authed = (token: string) => (req: request.Test) =>
  req.set('Authorization', `Bearer ${token}`);

describe('recurring expenses', () => {
  it('rejects an unauthenticated request', async () => {
    await request(app)
      .get('/api/v1/households/00000000-0000-0000-0000-000000000000/recurring-expenses')
      .expect(401);
  });

  it('creates a recurring expense and reports it as upcoming', async () => {
    const admin = await registerTestUser(app);
    const householdId = await createTestHousehold(app, admin);
    const member = await addTestMember(app, admin, householdId);

    const created = await authed(admin.accessToken)(
      request(app).post(`/api/v1/households/${householdId}/recurring-expenses`),
    )
      .send({
        description: 'Alquiler',
        defaultAmount: '100000.00',
        currencyCode: 'ARS',
        paidBy: admin.id,
        splitType: 'equal',
        participants: [{ userId: admin.id }, { userId: member.id }],
        frequency: 'monthly',
        startDate: '2026-01-01',
      })
      .expect(201);
    assert.equal(created.body.nextRunDate, '2026-01-01');
    assert.equal(created.body.isActive, true);

    const upcoming = await authed(admin.accessToken)(
      request(app).get(`/api/v1/households/${householdId}/recurring-expenses/upcoming`),
    ).expect(200);
    assert.equal(upcoming.body.length, 1);
    assert.equal(upcoming.body[0].id, created.body.id);
  });

  it('generates a pending occurrence, is idempotent, and advances nextRunDate', async () => {
    const admin = await registerTestUser(app);
    const householdId = await createTestHousehold(app, admin);
    const member = await addTestMember(app, admin, householdId);

    await authed(admin.accessToken)(
      request(app).post(`/api/v1/households/${householdId}/recurring-expenses`),
    )
      .send({
        description: 'Internet',
        defaultAmount: '15000.00',
        currencyCode: 'ARS',
        paidBy: admin.id,
        splitType: 'equal',
        participants: [{ userId: admin.id }, { userId: member.id }],
        frequency: 'monthly',
        startDate: '2026-01-01',
      })
      .expect(201);

    const runDate = new Date('2026-01-01T00:00:00.000Z');
    const firstRun = await generateDueOccurrences(runDate);
    assert.ok(firstRun >= 1);

    const list = await authed(admin.accessToken)(
      request(app).get(`/api/v1/households/${householdId}/expenses?status=pending`),
    ).expect(200);
    assert.equal(list.body.data.length, 1);
    const occurrence = list.body.data[0];
    assert.equal(occurrence.amount, '15000.00');
    assert.equal(
      occurrence.splits
        .reduce((sum: number, s: { amount: string }) => sum + Number(s.amount), 0)
        .toFixed(2),
      '15000.00',
    );

    // Running the job again for the same day must not create a duplicate.
    await generateDueOccurrences(runDate);
    const listAgain = await authed(admin.accessToken)(
      request(app).get(`/api/v1/households/${householdId}/expenses?status=pending`),
    ).expect(200);
    assert.equal(listAgain.body.data.length, 1);

    const recurringAfter = await authed(admin.accessToken)(
      request(app).get(`/api/v1/households/${householdId}/recurring-expenses`),
    ).expect(200);
    assert.equal(recurringAfter.body[0].nextRunDate, '2026-02-01');

    // Confirm turns it into a normal active expense that counts toward balances.
    const confirmed = await authed(admin.accessToken)(
      request(app).post(`/api/v1/households/${householdId}/expenses/${occurrence.id}/confirm`),
    ).expect(200);
    assert.equal(confirmed.body.status, 'active');

    const balances = await authed(admin.accessToken)(
      request(app).get(`/api/v1/households/${householdId}/balances`),
    ).expect(200);
    const adminBalance = balances.body.balances.find(
      (b: { userId: string }) => b.userId === admin.id,
    );
    assert.equal(adminBalance.net, '7500.00');
  });

  it('skipping a pending occurrence voids it and it never counts toward balances', async () => {
    const admin = await registerTestUser(app);
    const householdId = await createTestHousehold(app, admin);
    const member = await addTestMember(app, admin, householdId);

    await authed(admin.accessToken)(
      request(app).post(`/api/v1/households/${householdId}/recurring-expenses`),
    )
      .send({
        description: 'Streaming',
        defaultAmount: '5000.00',
        currencyCode: 'ARS',
        paidBy: admin.id,
        splitType: 'equal',
        participants: [{ userId: admin.id }, { userId: member.id }],
        frequency: 'monthly',
        startDate: '2026-03-01',
      })
      .expect(201);

    await generateDueOccurrences(new Date('2026-03-01T00:00:00.000Z'));
    const list = await authed(admin.accessToken)(
      request(app).get(`/api/v1/households/${householdId}/expenses?status=pending`),
    ).expect(200);
    const occurrence = list.body.data[0];

    await authed(admin.accessToken)(
      request(app).post(`/api/v1/households/${householdId}/expenses/${occurrence.id}/skip`),
    ).expect(204);

    const balances = await authed(admin.accessToken)(
      request(app).get(`/api/v1/households/${householdId}/balances`),
    ).expect(200);
    for (const balance of balances.body.balances) {
      assert.equal(balance.net, '0.00');
    }

    // Already resolved: confirming or skipping again is a conflict.
    await authed(admin.accessToken)(
      request(app).post(`/api/v1/households/${householdId}/expenses/${occurrence.id}/confirm`),
    )
      .expect(409)
      .expect((res) => assert.equal(res.body.error.code, 'RECURRING_OCCURRENCE_NOT_PENDING'));
  });

  it('catches up multiple missed daily occurrences in one run', async () => {
    const admin = await registerTestUser(app);
    const householdId = await createTestHousehold(app, admin);

    await authed(admin.accessToken)(
      request(app).post(`/api/v1/households/${householdId}/recurring-expenses`),
    )
      .send({
        description: 'Diario de prueba',
        defaultAmount: '10.00',
        currencyCode: 'ARS',
        paidBy: admin.id,
        splitType: 'equal',
        participants: [{ userId: admin.id }],
        frequency: 'daily',
        startDate: '2026-04-01',
      })
      .expect(201);

    await generateDueOccurrences(new Date('2026-04-04T00:00:00.000Z'));

    const list = await authed(admin.accessToken)(
      request(app).get(`/api/v1/households/${householdId}/expenses?status=pending&limit=10`),
    ).expect(200);
    assert.equal(list.body.data.length, 4);
  });

  it('does not generate occurrences for an inactive recurring expense', async () => {
    const admin = await registerTestUser(app);
    const householdId = await createTestHousehold(app, admin);

    const created = await authed(admin.accessToken)(
      request(app).post(`/api/v1/households/${householdId}/recurring-expenses`),
    )
      .send({
        description: 'Pausado',
        defaultAmount: '10.00',
        currencyCode: 'ARS',
        paidBy: admin.id,
        splitType: 'equal',
        participants: [{ userId: admin.id }],
        frequency: 'monthly',
        startDate: '2026-05-01',
      })
      .expect(201);

    await authed(admin.accessToken)(
      request(app).patch(`/api/v1/households/${householdId}/recurring-expenses/${created.body.id}`),
    )
      .send({ isActive: false })
      .expect(200);

    await generateDueOccurrences(new Date('2026-05-01T00:00:00.000Z'));

    const list = await authed(admin.accessToken)(
      request(app).get(`/api/v1/households/${householdId}/expenses?status=pending`),
    ).expect(200);
    assert.equal(list.body.data.length, 0);
  });
});
