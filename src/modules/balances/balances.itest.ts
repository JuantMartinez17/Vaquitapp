import { randomUUID } from 'node:crypto';
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { Decimal } from 'decimal.js';
import { app } from '../../app/app.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { registerTestUser, createTestHousehold, addTestMember } from '../../shared/testing/http.js';
import { calculateBalances } from '../../domain/balances/balance.js';
import { getMemberNet } from './balances.service.js';

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

describe('balances SQL aggregation vs the JS oracle', () => {
  it('matches calculateBalances for every split type, voided items and a former member', async () => {
    const admin = await registerTestUser(app);
    const householdId = await createTestHousehold(app, admin);
    const bea = await addTestMember(app, admin, householdId);
    const carl = await addTestMember(app, admin, householdId);
    const dana = await addTestMember(app, admin, householdId); // leaves with a balance
    const eve = await addTestMember(app, admin, householdId); // leaves settled up
    const everyone = [admin, bea, carl, dana, eve];

    const createExpense = async (body: Record<string, unknown>): Promise<string> => {
      const res = await authed(admin.accessToken)(
        request(app).post(`/api/v1/households/${householdId}/expenses`),
      )
        .send({ currencyCode: 'ARS', expenseDate: '2026-02-01', ...body })
        .expect(201);
      return res.body.id as string;
    };

    // equal: 100.00 / 3 does not divide exactly, so the remainder allocation matters.
    await createExpense({
      description: 'equal',
      amount: '100.00',
      paidBy: admin.id,
      splitType: 'equal',
      participants: [admin, bea, carl].map((u) => ({ userId: u.id })),
    });
    await createExpense({
      description: 'exact',
      amount: '90.50',
      paidBy: bea.id,
      splitType: 'exact',
      participants: [
        { userId: admin.id, amount: '10.50' },
        { userId: carl.id, amount: '30.00' },
        { userId: dana.id, amount: '50.00' },
      ],
    });
    await createExpense({
      description: 'percentage',
      amount: '250.00',
      paidBy: carl.id,
      splitType: 'percentage',
      participants: [
        { userId: admin.id, percentage: 33.33 },
        { userId: bea.id, percentage: 33.33 },
        { userId: dana.id, percentage: 33.34 },
      ],
    });
    await createExpense({
      description: 'shares',
      amount: '77.77',
      paidBy: dana.id,
      splitType: 'shares',
      participants: [
        { userId: admin.id, shares: 1 },
        { userId: carl.id, shares: 2 },
        { userId: dana.id, shares: 4 },
      ],
    });
    // Eve pays for herself only: active activity that nets to zero.
    await createExpense({
      description: 'solo',
      amount: '20.00',
      paidBy: eve.id,
      splitType: 'equal',
      participants: [{ userId: eve.id }],
    });
    const voidedExpenseId = await createExpense({
      description: 'voided',
      amount: '999.00',
      paidBy: admin.id,
      splitType: 'equal',
      participants: everyone.map((u) => ({ userId: u.id })),
    });
    await authed(admin.accessToken)(
      request(app).delete(`/api/v1/households/${householdId}/expenses/${voidedExpenseId}`),
    ).expect(204);

    // A pending recurring occurrence is not a fact yet and must not count.
    await prisma.expense.create({
      data: {
        householdId,
        paidBy: admin.id,
        createdBy: admin.id,
        description: 'pending',
        amount: '500.00',
        currencyCode: 'ARS',
        status: 'pending',
        splits: {
          create: [
            { userId: admin.id, amount: '250.00' },
            { userId: bea.id, amount: '250.00' },
          ],
        },
      },
    });

    const settle = (
      fromUser: string,
      toUser: string,
      amount: string,
      status: 'confirmed' | 'pending' | 'voided',
    ) =>
      prisma.settlement.create({
        data: {
          householdId,
          fromUser,
          toUser,
          amount,
          currencyCode: 'ARS',
          createdBy: admin.id,
          status,
        },
      });
    await settle(bea.id, admin.id, '12.34', 'confirmed');
    await settle(carl.id, bea.id, '5.00', 'pending'); // pending still moves the balance
    await settle(dana.id, admin.id, '777.00', 'voided');

    await prisma.householdMember.updateMany({
      where: { householdId, userId: { in: [dana.id, eve.id] } },
      data: { leftAt: new Date() },
    });

    // Oracle: the in-memory domain calculation over the same rows.
    const [expenses, settlements] = await Promise.all([
      prisma.expense.findMany({
        where: { householdId, status: 'active' },
        include: { splits: true },
      }),
      prisma.settlement.findMany({ where: { householdId, status: { not: 'voided' } } }),
    ]);
    const oracle = new Map(
      calculateBalances(
        expenses.map((e) => ({
          paidBy: e.paidBy,
          amount: e.amount,
          splits: e.splits.map((s) => ({ userId: s.userId, amount: s.amount })),
        })),
        settlements.map((s) => ({ fromUser: s.fromUser, toUser: s.toUser, amount: s.amount })),
      ).map((b) => [b.userId, b.net] as const),
    );
    assert.ok(oracle.get(eve.id)?.isZero(), 'fixture: the settled-up leaver nets to zero');
    assert.ok(!oracle.get(dana.id)?.isZero(), 'fixture: the indebted leaver has a balance');

    const res = await authed(admin.accessToken)(
      request(app).get(`/api/v1/households/${householdId}/balances`),
    ).expect(200);
    const rows = res.body.balances as { userId: string; net: string; isFormerMember: boolean }[];

    let total = new Decimal(0);
    for (const row of rows) {
      total = total.plus(row.net);
      assert.ok(new Decimal(row.net).eq(oracle.get(row.userId)!), `net of ${row.userId}`);
    }
    assert.ok(total.isZero(), 'balances sum to zero');

    const byUser = new Map(rows.map((r) => [r.userId, r]));
    for (const user of [admin, bea, carl]) {
      assert.equal(byUser.get(user.id)?.isFormerMember, false);
    }
    assert.equal(byUser.get(dana.id)?.isFormerMember, true);
    assert.equal(byUser.has(eve.id), false, 'a settled-up former member is omitted');

    // The single-member helper uses the same predicates.
    for (const user of everyone) {
      const net = await getMemberNet(prisma, householdId, user.id);
      assert.ok(net.eq(oracle.get(user.id) ?? 0), `getMemberNet of ${user.id}`);
    }

    // Both views agree on the former member: the simplified transfers clear
    // every balance, Dana's included, and flag her as a former member.
    const simplified = await authed(admin.accessToken)(
      request(app).get(`/api/v1/households/${householdId}/balances/simplified`),
    ).expect(200);
    const remaining = new Map(rows.map((r) => [r.userId, new Decimal(r.net)]));
    for (const t of simplified.body.simplified as {
      from: string;
      to: string;
      amount: string;
      fromIsFormerMember: boolean;
      toIsFormerMember: boolean;
    }[]) {
      remaining.set(t.from, remaining.get(t.from)!.plus(t.amount));
      remaining.set(t.to, remaining.get(t.to)!.minus(t.amount));
      assert.equal(t.fromIsFormerMember, t.from === dana.id);
      assert.equal(t.toIsFormerMember, t.to === dana.id);
    }
    for (const value of remaining.values()) {
      assert.ok(value.isZero());
    }
  });
});
