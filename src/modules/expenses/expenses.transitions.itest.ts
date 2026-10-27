import { randomUUID } from 'node:crypto';
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from '../../app/app.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { registerTestUser, createTestHousehold, addTestMember } from '../../shared/testing/http.js';
import type { TestUser } from '../../shared/testing/http.js';

after(async () => {
  await prisma.$disconnect();
});

const url = (householdId: string, suffix = '') =>
  `/api/v1/households/${householdId}/expenses${suffix}`;

const authed = (user: TestUser) => (req: request.Test) =>
  req.set('Authorization', `Bearer ${user.accessToken}`).set('Idempotency-Key', randomUUID());

const createExpense = async (user: TestUser, householdId: string, participants: TestUser[]) => {
  const res = await authed(user)(request(app).post(url(householdId)))
    .send({
      description: 'Original',
      amount: '30.00',
      currencyCode: 'ARS',
      expenseDate: '2026-01-15',
      paidBy: user.id,
      splitType: 'equal',
      participants: participants.map((p) => ({ userId: p.id })),
    })
    .expect(201);
  return res.body.id as string;
};

/** A recurring occurrence awaiting confirmation; the scheduler is the only API-less way to get one. */
const createPendingExpense = async (
  payer: TestUser,
  householdId: string,
  participants: TestUser[],
): Promise<string> => {
  const expense = await prisma.expense.create({
    data: {
      householdId,
      paidBy: payer.id,
      description: 'Recurring occurrence',
      amount: '30.00',
      currencyCode: 'ARS',
      splitType: 'equal',
      expenseDate: new Date('2026-02-01'),
      status: 'pending',
      createdBy: payer.id,
      splits: {
        create: participants.map((p) => ({
          userId: p.id,
          amount: (30 / participants.length).toFixed(2),
        })),
      },
    },
  });
  return expense.id;
};

describe('expense state transitions under concurrency', () => {
  it('voids an expense exactly once when requests race', async () => {
    const admin = await registerTestUser(app);
    const householdId = await createTestHousehold(app, admin);
    const expenseId = await createExpense(admin, householdId, [admin]);

    const responses = await Promise.all(
      Array.from({ length: 4 }, () =>
        authed(admin)(request(app).delete(url(householdId, `/${expenseId}`))),
      ),
    );

    assert.deepEqual(responses.map((res) => res.status).sort(), [204, 409, 409, 409]);
    for (const loser of responses.filter((res) => res.status === 409)) {
      assert.equal(loser.body.error.code, 'EXPENSE_ALREADY_VOIDED');
    }
  });

  it('never lets a concurrent edit change an expense once it is voided', async () => {
    const admin = await registerTestUser(app);
    const householdId = await createTestHousehold(app, admin);

    for (let round = 0; round < 6; round += 1) {
      const expenseId = await createExpense(admin, householdId, [admin]);
      const [voided, edited] = await Promise.all([
        authed(admin)(request(app).delete(url(householdId, `/${expenseId}`))),
        authed(admin)(request(app).patch(url(householdId, `/${expenseId}`))).send({
          description: 'Edited',
        }),
      ]);

      assert.equal(voided.status, 204);
      assert.ok([200, 409].includes(edited.status), `unexpected status ${edited.status}`);
      const stored = await prisma.expense.findUniqueOrThrow({ where: { id: expenseId } });
      assert.equal(stored.status, 'voided');
      // An edit that was told "voided" must not have been applied anyway.
      assert.equal(stored.description, edited.status === 200 ? 'Edited' : 'Original');
    }
  });

  it('still bumps updatedAt now that edits go through a conditional update', async () => {
    const admin = await registerTestUser(app);
    const householdId = await createTestHousehold(app, admin);
    const expenseId = await createExpense(admin, householdId, [admin]);
    const before = await prisma.expense.findUniqueOrThrow({ where: { id: expenseId } });

    await authed(admin)(request(app).patch(url(householdId, `/${expenseId}`)))
      .send({ description: 'Edited' })
      .expect(200);

    const after = await prisma.expense.findUniqueOrThrow({ where: { id: expenseId } });
    assert.ok(after.updatedAt.getTime() > before.updatedAt.getTime());
  });

  it('rejects editing an already voided expense', async () => {
    const admin = await registerTestUser(app);
    const householdId = await createTestHousehold(app, admin);
    const expenseId = await createExpense(admin, householdId, [admin]);
    await authed(admin)(request(app).delete(url(householdId, `/${expenseId}`))).expect(204);

    const res = await authed(admin)(request(app).patch(url(householdId, `/${expenseId}`)))
      .send({ description: 'Edited' })
      .expect(409);
    assert.equal(res.body.error.code, 'EXPENSE_ALREADY_VOIDED');
  });

  it('keeps splits consistent when two edits race', async () => {
    const admin = await registerTestUser(app);
    const householdId = await createTestHousehold(app, admin);
    const member = await addTestMember(app, admin, householdId);
    const expenseId = await createExpense(admin, householdId, [admin, member]);
    const edit = (amount: string) =>
      authed(admin)(request(app).patch(url(householdId, `/${expenseId}`))).send({
        amount,
        splitType: 'equal',
        participants: [{ userId: admin.id }, { userId: member.id }],
      });

    const responses = await Promise.all([edit('10.00'), edit('20.00'), edit('40.00')]);

    for (const res of responses) {
      assert.equal(res.status, 200, JSON.stringify(res.body));
    }
    const stored = await prisma.expense.findUniqueOrThrow({
      where: { id: expenseId },
      include: { splits: true },
    });
    assert.equal(stored.splits.length, 2);
    const total = stored.splits.reduce((sum, split) => sum + Number(split.amount), 0);
    assert.equal(total.toFixed(2), Number(stored.amount).toFixed(2));
  });

  it('confirms a pending occurrence exactly once when requests race', async () => {
    const admin = await registerTestUser(app);
    const householdId = await createTestHousehold(app, admin);
    const expenseId = await createPendingExpense(admin, householdId, [admin]);

    const responses = await Promise.all(
      Array.from({ length: 3 }, () =>
        authed(admin)(request(app).post(url(householdId, `/${expenseId}/confirm`))),
      ),
    );

    assert.deepEqual(responses.map((res) => res.status).sort(), [200, 409, 409]);
    for (const loser of responses.filter((res) => res.status === 409)) {
      assert.equal(loser.body.error.code, 'RECURRING_OCCURRENCE_NOT_PENDING');
    }
  });

  it('lets only one of a racing confirm and skip win', async () => {
    const admin = await registerTestUser(app);
    const householdId = await createTestHousehold(app, admin);
    const expenseId = await createPendingExpense(admin, householdId, [admin]);

    const [confirm, skip] = await Promise.all([
      authed(admin)(request(app).post(url(householdId, `/${expenseId}/confirm`))),
      authed(admin)(request(app).post(url(householdId, `/${expenseId}/skip`))),
    ]);

    const succeeded = [confirm.status === 200, skip.status === 204].filter(Boolean).length;
    assert.equal(succeeded, 1, `confirm=${confirm.status} skip=${skip.status}`);
    const stored = await prisma.expense.findUniqueOrThrow({ where: { id: expenseId } });
    assert.equal(stored.status, confirm.status === 200 ? 'active' : 'voided');
  });

  it('refuses to confirm when a participant is no longer an active member', async () => {
    const admin = await registerTestUser(app);
    const householdId = await createTestHousehold(app, admin);
    const member = await addTestMember(app, admin, householdId);
    const expenseId = await createPendingExpense(admin, householdId, [admin, member]);
    await prisma.householdMember.updateMany({
      where: { householdId, userId: member.id },
      data: { leftAt: new Date() },
    });

    const res = await authed(admin)(request(app).post(url(householdId, `/${expenseId}/confirm`)));
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'INVALID_PARTICIPANT');

    const stored = await prisma.expense.findUniqueOrThrow({ where: { id: expenseId } });
    assert.equal(stored.status, 'pending');

    // Skipping stays possible, so the occurrence can still be cleared.
    await authed(admin)(request(app).post(url(householdId, `/${expenseId}/skip`))).expect(204);
  });

  it('refuses to confirm when the payer is no longer an active member', async () => {
    const admin = await registerTestUser(app);
    const householdId = await createTestHousehold(app, admin);
    const payer = await addTestMember(app, admin, householdId);
    const expenseId = await createPendingExpense(payer, householdId, [admin]);
    await prisma.householdMember.updateMany({
      where: { householdId, userId: payer.id },
      data: { leftAt: new Date() },
    });

    const res = await authed(admin)(request(app).post(url(householdId, `/${expenseId}/confirm`)));
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'INVALID_PAYER');
  });

  it('answers 404 for an expense that belongs to another household', async () => {
    const admin = await registerTestUser(app);
    const householdId = await createTestHousehold(app, admin);
    const otherHouseholdId = await createTestHousehold(app, admin);
    const expenseId = await createExpense(admin, householdId, [admin]);

    await authed(admin)(request(app).delete(url(otherHouseholdId, `/${expenseId}`))).expect(404);
    await authed(admin)(request(app).patch(url(otherHouseholdId, `/${expenseId}`)))
      .send({ description: 'Edited' })
      .expect(404);
  });
});

describe('expenses list: voided rows', () => {
  it('hides voided expenses unless includeVoided=true', async () => {
    const admin = await registerTestUser(app);
    const householdId = await createTestHousehold(app, admin);
    const keptId = await createExpense(admin, householdId, [admin]);
    const voidedId = await createExpense(admin, householdId, [admin]);
    await authed(admin)(request(app).delete(url(householdId, `/${voidedId}`))).expect(204);

    const idsOf = async (query: string) => {
      const res = await authed(admin)(request(app).get(`${url(householdId)}${query}`)).expect(200);
      return (res.body.data as { id: string }[]).map((e) => e.id).sort();
    };

    assert.deepEqual(await idsOf(''), [keptId]);
    assert.deepEqual(await idsOf('?includeVoided=false'), [keptId]);
    assert.deepEqual(await idsOf('?includeVoided=true'), [keptId, voidedId].sort());
    assert.deepEqual(await idsOf('?status=voided'), [voidedId]);

    const invalid = await authed(admin)(
      request(app).get(`${url(householdId)}?includeVoided=maybe`),
    );
    assert.equal(invalid.status, 422);
  });
});
