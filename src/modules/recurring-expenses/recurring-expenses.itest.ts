import { randomUUID } from 'node:crypto';
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from '../../app/app.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { registerTestUser, createTestHousehold, addTestMember } from '../../shared/testing/http.js';
import { generateDueOccurrences, getUpcoming } from './recurring-expenses.service.js';

after(async () => {
  await prisma.$disconnect();
});

const authed = (token: string) => (req: request.Test) =>
  req.set('Authorization', `Bearer ${token}`).set('Idempotency-Key', randomUUID());

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

    const runDate = new Date('2026-01-01T12:00:00.000Z');
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

    await generateDueOccurrences(new Date('2026-03-01T12:00:00.000Z'));
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

    await generateDueOccurrences(new Date('2026-04-04T12:00:00.000Z'));

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

    await generateDueOccurrences(new Date('2026-05-01T12:00:00.000Z'));

    const list = await authed(admin.accessToken)(
      request(app).get(`/api/v1/households/${householdId}/expenses?status=pending`),
    ).expect(200);
    assert.equal(list.body.data.length, 0);
  });
});

describe('recurring generation limits', () => {
  const createTemplate = async (
    admin: Awaited<ReturnType<typeof registerTestUser>>,
    householdId: string,
    overrides: Record<string, unknown>,
  ): Promise<string> => {
    const res = await authed(admin.accessToken)(
      request(app).post(`/api/v1/households/${householdId}/recurring-expenses`),
    )
      .send({
        description: 'Template',
        defaultAmount: '10.00',
        currencyCode: 'ARS',
        paidBy: admin.id,
        splitType: 'equal',
        participants: [{ userId: admin.id }],
        frequency: 'monthly',
        startDate: '2026-01-01',
        ...overrides,
      })
      .expect(201);
    return res.body.id as string;
  };

  it('deactivates a template once its next run falls past the end date', async () => {
    const admin = await registerTestUser(app);
    const householdId = await createTestHousehold(app, admin);
    const id = await createTemplate(admin, householdId, { endDate: '2026-01-15' });

    await generateDueOccurrences(new Date('2026-01-01T12:00:00.000Z'));
    assert.equal(await prisma.expense.count({ where: { recurringExpenseId: id } }), 1);

    // A later run must neither generate more nor keep the template alive.
    await generateDueOccurrences(new Date('2026-03-01T12:00:00.000Z'));
    assert.equal(await prisma.expense.count({ where: { recurringExpenseId: id } }), 1);
    const template = await prisma.recurringExpense.findUniqueOrThrow({ where: { id } });
    assert.equal(template.isActive, false);
  });

  it('deactivates a template whose end date is already behind its next run', async () => {
    const admin = await registerTestUser(app);
    const householdId = await createTestHousehold(app, admin);
    const id = await createTemplate(admin, householdId, { endDate: '2025-12-01' });

    await generateDueOccurrences(new Date('2026-01-10T12:00:00.000Z'));

    assert.equal(await prisma.expense.count({ where: { recurringExpenseId: id } }), 0);
    const template = await prisma.recurringExpense.findUniqueOrThrow({ where: { id } });
    assert.equal(template.isActive, false);
  });

  describe('household timezone', () => {
    // Years far from the 2026 dates other tests use: the job sweeps every
    // template in the database, so these runs must not feed theirs. Each
    // template ends on its start date so it is finished once it has run.
    const START = '2018-03-11';

    const setupHousehold = async (timezone: string) => {
      const admin = await registerTestUser(app);
      const householdId = await createTestHousehold(app, admin);
      await prisma.household.update({ where: { id: householdId }, data: { timezone } });
      const id = await createTemplate(admin, householdId, { startDate: START, endDate: START });
      return { admin, householdId, id };
    };
    const generated = (id: string) => prisma.expense.count({ where: { recurringExpenseId: id } });

    it('waits for local midnight in a zone behind UTC', async () => {
      const { id } = await setupHousehold('America/Argentina/Buenos_Aires');

      // 22:00 on 2018-03-10 in Buenos Aires, already 2018-03-11 in UTC.
      await generateDueOccurrences(new Date('2018-03-11T01:00:00.000Z'));
      assert.equal(await generated(id), 0);

      // 00:00 on 2018-03-11 in Buenos Aires.
      await generateDueOccurrences(new Date('2018-03-11T03:00:00.000Z'));
      assert.equal(await generated(id), 1);
    });

    it('generates at local midnight in a zone ahead of UTC', async () => {
      const { id } = await setupHousehold('Asia/Tokyo');

      // 23:59 on 2018-03-10 in Tokyo.
      await generateDueOccurrences(new Date('2018-03-10T14:59:00.000Z'));
      assert.equal(await generated(id), 0);

      // 00:00 on 2018-03-11 in Tokyo, still 2018-03-10 in UTC.
      await generateDueOccurrences(new Date('2018-03-10T15:00:00.000Z'));
      assert.equal(await generated(id), 1);
    });

    it('judges each household in its own zone within the same run', async () => {
      const buenosAires = await setupHousehold('America/Argentina/Buenos_Aires');
      const tokyo = await setupHousehold('Asia/Tokyo');

      // 2018-03-11 01:00 UTC: Tokyo is on the 11th, Buenos Aires still on the 10th.
      await generateDueOccurrences(new Date('2018-03-11T01:00:00.000Z'));
      assert.equal(await generated(tokyo.id), 1);
      assert.equal(await generated(buenosAires.id), 0);

      await generateDueOccurrences(new Date('2018-03-11T03:00:00.000Z'));
      assert.equal(await generated(buenosAires.id), 1);
    });

    it('falls back to UTC for an unusable stored zone instead of skipping the household', async () => {
      const { id } = await setupHousehold('Mars/Olympus');

      await generateDueOccurrences(new Date('2018-03-11T01:00:00.000Z'));
      assert.equal(await generated(id), 1);
    });

    it('flags a template as overdue by the household date in /upcoming', async () => {
      const buenosAires = await setupHousehold('America/Argentina/Buenos_Aires');
      const tokyo = await setupHousehold('Asia/Tokyo');
      const now = new Date('2018-03-11T01:00:00.000Z');

      const [bsAsUpcoming] = await getUpcoming(buenosAires.householdId, now);
      const [tokyoUpcoming] = await getUpcoming(tokyo.householdId, now);
      assert.equal(bsAsUpcoming?.overdue, false);
      assert.equal(tokyoUpcoming?.overdue, true);

      // Leave nothing active behind for later runs to pick up.
      await generateDueOccurrences(new Date('2018-03-11T12:00:00.000Z'));
    });
  });

  it('caps the occurrences per template per run and resumes where it stopped', async () => {
    const admin = await registerTestUser(app);
    const householdId = await createTestHousehold(app, admin);
    const id = await createTemplate(admin, householdId, {
      frequency: 'daily',
      startDate: '2019-01-01',
    });
    // Far from the 2026 dates other tests use: the job sweeps every template in
    // the database, so a late run date here would also feed their templates.
    const longAfter = new Date('2019-12-31T12:00:00.000Z');

    await generateDueOccurrences(longAfter);
    assert.equal(await prisma.expense.count({ where: { recurringExpenseId: id } }), 62);
    const afterFirst = await prisma.recurringExpense.findUniqueOrThrow({ where: { id } });
    assert.equal(afterFirst.nextRunDate.toISOString().slice(0, 10), '2019-03-04');
    assert.equal(afterFirst.lastGeneratedDate?.toISOString().slice(0, 10), '2019-03-03');
    assert.equal(afterFirst.isActive, true);

    await generateDueOccurrences(longAfter);
    assert.equal(await prisma.expense.count({ where: { recurringExpenseId: id } }), 124);
    // Park the template so later runs by other tests do not keep feeding on it.
    await prisma.recurringExpense.update({ where: { id }, data: { isActive: false } });
  });

  it('requires an Idempotency-Key on creation and replays the original response', async () => {
    const admin = await registerTestUser(app);
    const householdId = await createTestHousehold(app, admin);
    const body = {
      description: 'Once',
      defaultAmount: '10.00',
      currencyCode: 'ARS',
      paidBy: admin.id,
      splitType: 'equal',
      participants: [{ userId: admin.id }],
      frequency: 'monthly',
      startDate: '2026-01-01',
    };
    const url = `/api/v1/households/${householdId}/recurring-expenses`;

    await request(app)
      .post(url)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send(body)
      .expect(400);

    const key = randomUUID();
    const send = () =>
      request(app)
        .post(url)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .set('Idempotency-Key', key)
        .send(body)
        .expect(201);
    const first = await send();
    const replay = await send();
    assert.equal(replay.body.id, first.body.id);
    assert.equal(await prisma.recurringExpense.count({ where: { householdId } }), 1);
  });
});
