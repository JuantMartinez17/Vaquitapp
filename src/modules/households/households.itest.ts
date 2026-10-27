import { randomUUID } from 'node:crypto';
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from '../../app/app.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import {
  registerTestUser,
  createTestHousehold,
  addTestMember,
  type TestUser,
} from '../../shared/testing/http.js';
import { changeMemberRole } from './households.service.js';

after(async () => {
  await prisma.$disconnect();
});

const as = (user: TestUser) => (req: request.Test) =>
  req.set('Authorization', `Bearer ${user.accessToken}`).set('Idempotency-Key', randomUUID());

const base = (householdId: string) => `/api/v1/households/${householdId}`;

/** `payer` pays `amount`, split equally between `payer` and `other`. */
const createExpense = async (
  householdId: string,
  payer: TestUser,
  other: TestUser,
  amount = '100.00',
): Promise<void> => {
  await as(payer)(request(app).post(`${base(householdId)}/expenses`))
    .send({
      description: 'Groceries',
      amount,
      currencyCode: 'ARS',
      expenseDate: '2026-01-01',
      paidBy: payer.id,
      splitType: 'equal',
      participants: [{ userId: payer.id }, { userId: other.id }],
    })
    .expect(201);
};

const promote = async (admin: TestUser, householdId: string, member: TestUser): Promise<void> => {
  await as(admin)(request(app).patch(`${base(householdId)}/members/${member.id}`))
    .send({ role: 'admin' })
    .expect(200);
};

describe('leaving a household', () => {
  it('lets an active member with a zero balance leave, keeping the membership row', async () => {
    const admin = await registerTestUser(app);
    const householdId = await createTestHousehold(app, admin);
    const member = await addTestMember(app, admin, householdId);

    await as(member)(request(app).post(`${base(householdId)}/members/leave`)).expect(204);

    const row = await prisma.householdMember.findFirstOrThrow({
      where: { householdId, userId: member.id },
    });
    assert.ok(row.leftAt, 'leftAt is set, the row is not deleted');
    await as(member)(request(app).get(base(householdId))).expect(403);
  });

  it('blocks a member who owes money', async () => {
    const admin = await registerTestUser(app);
    const householdId = await createTestHousehold(app, admin);
    const debtor = await addTestMember(app, admin, householdId);
    await createExpense(householdId, admin, debtor);

    const res = await as(debtor)(request(app).post(`${base(householdId)}/members/leave`)).expect(
      409,
    );
    assert.equal(res.body.error.code, 'MEMBER_HAS_OPEN_BALANCE');
    const row = await prisma.householdMember.findFirstOrThrow({
      where: { householdId, userId: debtor.id },
    });
    assert.equal(row.leftAt, null);
  });

  it('blocks a member who is owed money', async () => {
    const admin = await registerTestUser(app);
    const householdId = await createTestHousehold(app, admin);
    const creditor = await addTestMember(app, admin, householdId);
    await createExpense(householdId, creditor, admin);

    const res = await as(creditor)(request(app).post(`${base(householdId)}/members/leave`)).expect(
      409,
    );
    assert.equal(res.body.error.code, 'MEMBER_HAS_OPEN_BALANCE');
  });

  it('lets a member leave once a settlement zeroes their balance', async () => {
    const admin = await registerTestUser(app);
    const householdId = await createTestHousehold(app, admin);
    const debtor = await addTestMember(app, admin, householdId);
    await createExpense(householdId, admin, debtor);

    await as(debtor)(request(app).post(`${base(householdId)}/settlements`))
      .send({
        fromUser: debtor.id,
        toUser: admin.id,
        amount: '50.00',
        currencyCode: 'ARS',
        settlementDate: '2026-01-02',
      })
      .expect(201);

    await as(debtor)(request(app).post(`${base(householdId)}/members/leave`)).expect(204);
  });

  it('ignores a voided expense when checking the balance', async () => {
    const admin = await registerTestUser(app);
    const householdId = await createTestHousehold(app, admin);
    const member = await addTestMember(app, admin, householdId);
    await createExpense(householdId, admin, member);
    const expense = await prisma.expense.findFirstOrThrow({ where: { householdId } });
    await as(admin)(request(app).delete(`${base(householdId)}/expenses/${expense.id}`)).expect(204);

    await as(member)(request(app).post(`${base(householdId)}/members/leave`)).expect(204);
  });

  it('does not let the last admin leave', async () => {
    const admin = await registerTestUser(app);
    const householdId = await createTestHousehold(app, admin);
    await addTestMember(app, admin, householdId);

    const res = await as(admin)(request(app).post(`${base(householdId)}/members/leave`)).expect(
      409,
    );
    assert.equal(res.body.error.code, 'LAST_ADMIN');
  });

  it('lets an admin leave when another admin remains', async () => {
    const admin = await registerTestUser(app);
    const householdId = await createTestHousehold(app, admin);
    const second = await addTestMember(app, admin, householdId);
    await promote(admin, householdId, second);

    await as(admin)(request(app).post(`${base(householdId)}/members/leave`)).expect(204);
  });

  it('rejects a user who is not a member', async () => {
    const admin = await registerTestUser(app);
    const householdId = await createTestHousehold(app, admin);
    const outsider = await registerTestUser(app);

    const res = await as(outsider)(request(app).post(`${base(householdId)}/members/leave`)).expect(
      403,
    );
    assert.equal(res.body.error.code, 'NOT_A_MEMBER');
  });

  it('lets only one of two admins leave when they race', async () => {
    const admin = await registerTestUser(app);
    const householdId = await createTestHousehold(app, admin);
    const second = await addTestMember(app, admin, householdId);
    await promote(admin, householdId, second);

    const statuses = (
      await Promise.all(
        [admin, second].map((user) =>
          as(user)(request(app).post(`${base(householdId)}/members/leave`)),
        ),
      )
    )
      .map((res) => res.status)
      .sort();
    assert.deepEqual(statuses, [204, 409]);
    const admins = await prisma.householdMember.count({
      where: { householdId, role: 'admin', leftAt: null },
    });
    assert.equal(admins, 1);
  });
});

describe('removing a member', () => {
  it('is blocked while the member has an open balance', async () => {
    const admin = await registerTestUser(app);
    const householdId = await createTestHousehold(app, admin);
    const member = await addTestMember(app, admin, householdId);
    await createExpense(householdId, admin, member);

    const res = await as(admin)(
      request(app).delete(`${base(householdId)}/members/${member.id}`),
    ).expect(409);
    assert.equal(res.body.error.code, 'MEMBER_HAS_OPEN_BALANCE');
  });

  it('succeeds at a zero balance', async () => {
    const admin = await registerTestUser(app);
    const householdId = await createTestHousehold(app, admin);
    const member = await addTestMember(app, admin, householdId);

    await as(admin)(request(app).delete(`${base(householdId)}/members/${member.id}`)).expect(204);
  });

  it('answers 404 for a user who is not a member', async () => {
    const admin = await registerTestUser(app);
    const householdId = await createTestHousehold(app, admin);
    const outsider = await registerTestUser(app);

    const res = await as(admin)(
      request(app).delete(`${base(householdId)}/members/${outsider.id}`),
    ).expect(404);
    assert.equal(res.body.error.code, 'NOT_A_MEMBER');
  });

  it('answers 409 LAST_ADMIN when removing the only admin', async () => {
    const admin = await registerTestUser(app);
    const householdId = await createTestHousehold(app, admin);
    await addTestMember(app, admin, householdId);

    const res = await as(admin)(
      request(app).delete(`${base(householdId)}/members/${admin.id}`),
    ).expect(409);
    assert.equal(res.body.error.code, 'LAST_ADMIN');
  });
});

describe('changing a member role', () => {
  it('answers 409 LAST_ADMIN when demoting the only admin', async () => {
    const admin = await registerTestUser(app);
    const householdId = await createTestHousehold(app, admin);

    const res = await as(admin)(request(app).patch(`${base(householdId)}/members/${admin.id}`))
      .send({ role: 'member' })
      .expect(409);
    assert.equal(res.body.error.code, 'LAST_ADMIN');
  });

  it('never leaves the household without an admin when two admins demote each other', async () => {
    const admin = await registerTestUser(app);
    const householdId = await createTestHousehold(app, admin);
    const second = await addTestMember(app, admin, householdId);
    await promote(admin, householdId, second);

    const results = await Promise.all([
      as(admin)(request(app).patch(`${base(householdId)}/members/${second.id}`)).send({
        role: 'member',
      }),
      as(second)(request(app).patch(`${base(householdId)}/members/${admin.id}`)).send({
        role: 'member',
      }),
    ]);
    // A demoted admin may fail the role check (403) once the other request
    // commits first; what matters is the invariant.
    assert.ok(results.some((res) => res.status === 200));
    const admins = await prisma.householdMember.count({
      where: { householdId, role: 'admin', leftAt: null },
    });
    assert.equal(admins, 1);
  });
});

describe('last-admin invariant under concurrency', () => {
  // The HTTP-level race above depends on request timing; calling the service
  // directly skips the role middleware, so both demotions reach the
  // count-then-update step together.
  it('keeps one admin when two admins demote each other concurrently', async () => {
    for (let round = 0; round < 5; round += 1) {
      const admin = await registerTestUser(app);
      const householdId = await createTestHousehold(app, admin);
      const second = await addTestMember(app, admin, householdId);
      await promote(admin, householdId, second);

      const outcomes = await Promise.allSettled([
        changeMemberRole(householdId, second.id, 'member'),
        changeMemberRole(householdId, admin.id, 'member'),
      ]);
      assert.equal(outcomes.filter((o) => o.status === 'fulfilled').length, 1);
      const admins = await prisma.householdMember.count({
        where: { householdId, role: 'admin', leftAt: null },
      });
      assert.equal(admins, 1, `round ${round}`);
    }
  });
});

describe('household currency', () => {
  it('can change while the household has no financial activity', async () => {
    const admin = await registerTestUser(app);
    const householdId = await createTestHousehold(app, admin);

    const res = await as(admin)(request(app).patch(base(householdId)))
      .send({ defaultCurrencyCode: 'USD' })
      .expect(200);
    assert.equal(res.body.defaultCurrencyCode, 'USD');
  });

  it('is locked once an expense exists', async () => {
    const admin = await registerTestUser(app);
    const householdId = await createTestHousehold(app, admin);
    const member = await addTestMember(app, admin, householdId);
    await createExpense(householdId, admin, member);

    const res = await as(admin)(request(app).patch(base(householdId)))
      .send({ defaultCurrencyCode: 'USD' })
      .expect(409);
    assert.equal(res.body.error.code, 'HOUSEHOLD_CURRENCY_LOCKED');
  });

  it('stays locked after the only expense is voided', async () => {
    const admin = await registerTestUser(app);
    const householdId = await createTestHousehold(app, admin);
    const member = await addTestMember(app, admin, householdId);
    await createExpense(householdId, admin, member);
    const expense = await prisma.expense.findFirstOrThrow({ where: { householdId } });
    await as(admin)(request(app).delete(`${base(householdId)}/expenses/${expense.id}`)).expect(204);

    await as(admin)(request(app).patch(base(householdId)))
      .send({ defaultCurrencyCode: 'USD' })
      .expect(409);
  });

  it('is locked by a recurring template, even a deleted one', async () => {
    const admin = await registerTestUser(app);
    const householdId = await createTestHousehold(app, admin);
    await prisma.recurringExpense.create({
      data: {
        householdId,
        paidBy: admin.id,
        createdBy: admin.id,
        description: 'Rent',
        defaultAmount: '10.00',
        currencyCode: 'ARS',
        startDate: new Date('2026-01-01'),
        nextRunDate: new Date('2026-01-01'),
        deletedAt: new Date(),
      },
    });

    await as(admin)(request(app).patch(base(householdId)))
      .send({ defaultCurrencyCode: 'USD' })
      .expect(409);
  });

  it('is locked by an income', async () => {
    const admin = await registerTestUser(app);
    const householdId = await createTestHousehold(app, admin);
    await as(admin)(request(app).post(`${base(householdId)}/incomes`))
      .send({
        description: 'Salary',
        amount: '1000.00',
        currencyCode: 'ARS',
        incomeDate: '2026-01-01',
        receivedBy: admin.id,
      })
      .expect(201);

    await as(admin)(request(app).patch(base(householdId)))
      .send({ defaultCurrencyCode: 'USD' })
      .expect(409);
  });

  it('still allows renaming, and re-sending the same currency, after activity', async () => {
    const admin = await registerTestUser(app);
    const householdId = await createTestHousehold(app, admin);
    const member = await addTestMember(app, admin, householdId);
    await createExpense(householdId, admin, member);

    const res = await as(admin)(request(app).patch(base(householdId)))
      .send({ name: 'Renamed', defaultCurrencyCode: 'ARS' })
      .expect(200);
    assert.equal(res.body.name, 'Renamed');
  });
});
