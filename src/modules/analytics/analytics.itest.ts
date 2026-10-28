import { randomUUID } from 'node:crypto';
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { Decimal } from 'decimal.js';
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

  it('rejects a date that is not on the calendar instead of rolling it over', async () => {
    const admin = await registerTestUser(app);
    const householdId = await createTestHousehold(app, admin);

    for (const range of ['from=2026-02-31&to=2026-03-31', 'from=2026-02-01&to=2026-02-30']) {
      const res = await authed(admin.accessToken)(
        request(app).get(`/api/v1/households/${householdId}/analytics/summary?${range}`),
      ).expect(422);
      assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    }
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

describe('analytics output stays exact', () => {
  const createExpense = async (
    admin: Awaited<ReturnType<typeof registerTestUser>>,
    householdId: string,
    body: Record<string, unknown>,
  ): Promise<void> => {
    await authed(admin.accessToken)(request(app).post(`/api/v1/households/${householdId}/expenses`))
      .send({ currencyCode: 'ARS', splitType: 'equal', paidBy: admin.id, ...body })
      .expect(201);
  };

  it('buckets over-time by week and month on calendar boundaries', async () => {
    const admin = await registerTestUser(app);
    const householdId = await createTestHousehold(app, admin);
    const participants = [{ userId: admin.id }];
    // 2026-03-04 is a Wednesday, so its ISO week starts Monday 2026-03-02.
    for (const [expenseDate, amount] of [
      ['2026-03-04', '10.00'],
      ['2026-03-10', '20.00'],
      ['2026-03-12', '5.50'],
      ['2026-04-02', '7.25'],
    ] as const) {
      await createExpense(admin, householdId, {
        description: 'x',
        amount,
        expenseDate,
        participants,
      });
    }
    const overTime = async (granularity: string) => {
      const res = await authed(admin.accessToken)(
        request(app).get(
          `/api/v1/households/${householdId}/analytics/over-time?from=2026-03-01&to=2026-04-30&granularity=${granularity}`,
        ),
      ).expect(200);
      return res.body as { date: string; totalSpent: string }[];
    };

    assert.deepEqual(await overTime('week'), [
      { date: '2026-03-02', totalSpent: '10.00' },
      { date: '2026-03-09', totalSpent: '25.50' },
      { date: '2026-03-30', totalSpent: '7.25' },
    ]);
    assert.deepEqual(await overTime('month'), [
      { date: '2026-03-01', totalSpent: '35.50' },
      { date: '2026-04-01', totalSpent: '7.25' },
    ]);
  });

  it('by-member matches the stored splits, ordered by total and then by user id', async () => {
    const admin = await registerTestUser(app);
    const householdId = await createTestHousehold(app, admin);
    const bea = await addTestMember(app, admin, householdId);
    const carl = await addTestMember(app, admin, householdId);
    const everyone = [admin, bea, carl];

    // 100.00 / 3 leaves a remainder, so the three shares differ by a cent.
    await createExpense(admin, householdId, {
      description: 'thirds',
      amount: '100.00',
      expenseDate: '2026-03-05',
      participants: everyone.map((u) => ({ userId: u.id })),
    });
    await createExpense(admin, householdId, {
      description: 'duo',
      amount: '40.00',
      expenseDate: '2026-03-06',
      participants: [admin, bea].map((u) => ({ userId: u.id })),
    });
    await createExpense(admin, householdId, {
      description: 'outside the range',
      amount: '500.00',
      expenseDate: '2026-05-06',
      participants: everyone.map((u) => ({ userId: u.id })),
    });

    const splits = await prisma.expenseSplit.findMany({
      where: { expense: { householdId, expenseDate: { lt: new Date('2026-04-01') } } },
    });
    const expected = new Map<string, Decimal>();
    for (const split of splits) {
      expected.set(split.userId, (expected.get(split.userId) ?? new Decimal(0)).plus(split.amount));
    }

    const res = await authed(admin.accessToken)(
      request(app).get(
        `/api/v1/households/${householdId}/analytics/by-member?from=2026-03-01&to=2026-03-31`,
      ),
    ).expect(200);
    const rows = res.body as { userId: string; displayName: string | null; totalSpent: string }[];

    assert.equal(rows.length, 3);
    for (const row of rows) {
      assert.equal(row.totalSpent, expected.get(row.userId)!.toFixed(2));
      assert.equal(row.displayName, 'Test User');
    }
    const keys = rows.map((r) => [new Decimal(r.totalSpent), r.userId] as const);
    for (let index = 1; index < keys.length; index += 1) {
      const [previousTotal, previousId] = keys[index - 1]!;
      const [total, id] = keys[index]!;
      assert.ok(
        previousTotal.gt(total) || (previousTotal.eq(total) && previousId < id),
        'ordered by total desc, ties by user id',
      );
    }
  });

  it('comparison equals two independent summaries of the adjacent periods', async () => {
    const admin = await registerTestUser(app);
    const householdId = await createTestHousehold(app, admin);
    const participants = [{ userId: admin.id }];
    await createExpense(admin, householdId, {
      description: 'current',
      amount: '30.00',
      expenseDate: '2026-03-15',
      participants,
    });
    await createExpense(admin, householdId, {
      description: 'previous',
      amount: '12.50',
      expenseDate: '2026-02-20',
      participants,
    });
    const get = async (path: string) =>
      (
        await authed(admin.accessToken)(
          request(app).get(`/api/v1/households/${householdId}/${path}`),
        ).expect(200)
      ).body;

    const comparison = await get('analytics/comparison?from=2026-03-01&to=2026-03-31');
    // 31 days ending the day before the range starts.
    assert.deepEqual(
      comparison.current,
      await get('analytics/summary?from=2026-03-01&to=2026-03-31'),
    );
    assert.deepEqual(
      comparison.previous,
      await get('analytics/summary?from=2026-01-29&to=2026-02-28'),
    );
    assert.equal(comparison.previous.totalSpent, '12.50');
  });
});
