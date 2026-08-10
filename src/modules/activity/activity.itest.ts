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
  req.set('Authorization', `Bearer ${token}`);

describe('activity', () => {
  it('rejects an unauthenticated request', async () => {
    await request(app)
      .get('/api/v1/households/00000000-0000-0000-0000-000000000000/activity')
      .expect(401);
  });

  it('merges expenses, incomes, transfers and settlements into one chronological feed', async () => {
    const admin = await registerTestUser(app);
    const householdId = await createTestHousehold(app, admin);
    const member = await addTestMember(app, admin, householdId);

    await authed(admin.accessToken)(request(app).post(`/api/v1/households/${householdId}/expenses`))
      .send({
        description: 'Expense day 1',
        amount: '10.00',
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
        description: 'Income day 2',
        amount: '20.00',
        currencyCode: 'ARS',
        incomeDate: '2026-01-02',
      })
      .expect(201);

    await authed(admin.accessToken)(
      request(app).post(`/api/v1/households/${householdId}/transfers`),
    )
      .send({
        fromUser: admin.id,
        toUser: member.id,
        amount: '30.00',
        currencyCode: 'ARS',
        transferDate: '2026-01-03',
      })
      .expect(201);

    await authed(admin.accessToken)(
      request(app).post(`/api/v1/households/${householdId}/settlements`),
    )
      .send({
        fromUser: member.id,
        toUser: admin.id,
        amount: '40.00',
        currencyCode: 'ARS',
        settlementDate: '2026-01-04',
      })
      .expect(201);

    const feed = await authed(admin.accessToken)(
      request(app).get(`/api/v1/households/${householdId}/activity`),
    ).expect(200);
    assert.equal(feed.body.data.length, 4);
    // Most recent first.
    assert.deepEqual(
      feed.body.data.map((item: { type: string; date: string }) => `${item.date}:${item.type}`),
      ['2026-01-04:settlement', '2026-01-03:transfer', '2026-01-02:income', '2026-01-01:expense'],
    );
  });

  it('paginates across the merged feed without gaps or duplicates', async () => {
    const admin = await registerTestUser(app);
    const householdId = await createTestHousehold(app, admin);

    // 5 expenses on 5 distinct days: exercises cross-source keyset pagination
    // even though every item here is the same activity type.
    for (let day = 1; day <= 5; day++) {
      await authed(admin.accessToken)(
        request(app).post(`/api/v1/households/${householdId}/expenses`),
      )
        .send({
          description: `Expense day ${day}`,
          amount: '5.00',
          currencyCode: 'ARS',
          expenseDate: `2026-02-0${day}`,
          paidBy: admin.id,
          splitType: 'equal',
          participants: [{ userId: admin.id }],
        })
        .expect(201);
    }

    const seen: string[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 10; i++) {
      const page = await authed(admin.accessToken)(
        request(app).get(
          `/api/v1/households/${householdId}/activity?limit=2${cursor ? `&cursor=${cursor}` : ''}`,
        ),
      ).expect(200);
      seen.push(...page.body.data.map((item: { id: string }) => item.id));
      if (!page.body.nextCursor) break;
      cursor = page.body.nextCursor;
    }

    assert.equal(seen.length, 5);
    assert.equal(new Set(seen).size, 5, 'no duplicate items across pages');
  });
});
