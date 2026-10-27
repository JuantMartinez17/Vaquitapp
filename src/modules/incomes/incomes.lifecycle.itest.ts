import { randomUUID } from 'node:crypto';
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from '../../app/app.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { registerTestUser, createTestHousehold } from '../../shared/testing/http.js';
import type { TestUser } from '../../shared/testing/http.js';

after(async () => {
  await prisma.$disconnect();
});

const url = (householdId: string, suffix = '') =>
  `/api/v1/households/${householdId}/incomes${suffix}`;

const authed = (user: TestUser) => (req: request.Test) =>
  req.set('Authorization', `Bearer ${user.accessToken}`).set('Idempotency-Key', randomUUID());

const setup = async () => {
  const admin = await registerTestUser(app);
  const householdId = await createTestHousehold(app, admin);
  return { admin, householdId };
};

const createIncome = async (user: TestUser, householdId: string) => {
  const res = await authed(user)(request(app).post(url(householdId)))
    .send({
      receivedBy: user.id,
      description: 'Salary',
      amount: '1500.00',
      currencyCode: 'ARS',
      incomeDate: '2026-01-05',
    })
    .expect(201);
  return res.body.id as string;
};

describe('incomes: state transitions', () => {
  it('voids exactly once when requests race', async () => {
    const { admin, householdId } = await setup();
    const id = await createIncome(admin, householdId);

    const responses = await Promise.all(
      Array.from({ length: 4 }, () =>
        authed(admin)(request(app).delete(url(householdId, `/${id}`))),
      ),
    );

    assert.deepEqual(responses.map((res) => res.status).sort(), [204, 409, 409, 409]);
    for (const loser of responses.filter((res) => res.status === 409)) {
      assert.equal(loser.body.error.code, 'INCOME_ALREADY_VOIDED');
    }
  });

  it('never lets a concurrent edit change an income once it is voided', async () => {
    const { admin, householdId } = await setup();

    for (let round = 0; round < 6; round += 1) {
      const id = await createIncome(admin, householdId);
      const [voided, edited] = await Promise.all([
        authed(admin)(request(app).delete(url(householdId, `/${id}`))),
        authed(admin)(request(app).patch(url(householdId, `/${id}`))).send({
          description: 'Edited',
        }),
      ]);

      assert.equal(voided.status, 204);
      assert.ok([200, 409].includes(edited.status), `unexpected status ${edited.status}`);
      const stored = await prisma.income.findUniqueOrThrow({ where: { id } });
      assert.notEqual(stored.voidedAt, null);
      assert.equal(stored.description, edited.status === 200 ? 'Edited' : 'Salary');
    }
  });

  it('rejects editing an already voided income', async () => {
    const { admin, householdId } = await setup();
    const id = await createIncome(admin, householdId);
    await authed(admin)(request(app).delete(url(householdId, `/${id}`))).expect(204);

    const res = await authed(admin)(request(app).patch(url(householdId, `/${id}`)))
      .send({ description: 'Edited' })
      .expect(409);
    assert.equal(res.body.error.code, 'INCOME_ALREADY_VOIDED');
  });

  it('answers 404 for an income of another household', async () => {
    const { admin, householdId } = await setup();
    const otherHouseholdId = await createTestHousehold(app, admin);
    const id = await createIncome(admin, householdId);

    await authed(admin)(request(app).delete(url(otherHouseholdId, `/${id}`))).expect(404);
    await authed(admin)(request(app).patch(url(otherHouseholdId, `/${id}`)))
      .send({ description: 'Edited' })
      .expect(404);
  });
});

describe('incomes: reading', () => {
  it('returns one income by id, voided or not', async () => {
    const { admin, householdId } = await setup();
    const id = await createIncome(admin, householdId);

    const found = await authed(admin)(request(app).get(url(householdId, `/${id}`))).expect(200);
    assert.equal(found.body.id, id);
    assert.equal(found.body.voided, false);

    await authed(admin)(request(app).delete(url(householdId, `/${id}`))).expect(204);
    const voided = await authed(admin)(request(app).get(url(householdId, `/${id}`))).expect(200);
    assert.equal(voided.body.voided, true);
  });

  it('answers 404 by id for unknown ids and other households, and 403 to outsiders', async () => {
    const { admin, householdId } = await setup();
    const otherHouseholdId = await createTestHousehold(app, admin);
    const outsider = await registerTestUser(app);
    const id = await createIncome(admin, householdId);

    await authed(admin)(request(app).get(url(householdId, `/${randomUUID()}`))).expect(404);
    await authed(admin)(request(app).get(url(otherHouseholdId, `/${id}`))).expect(404);
    await authed(outsider)(request(app).get(url(householdId, `/${id}`))).expect(403);
    await authed(admin)(request(app).get(url(householdId, '/not-a-uuid'))).expect(422);
  });

  it('hides voided incomes from the list unless includeVoided=true', async () => {
    const { admin, householdId } = await setup();
    const kept = await createIncome(admin, householdId);
    const voided = await createIncome(admin, householdId);
    await authed(admin)(request(app).delete(url(householdId, `/${voided}`))).expect(204);

    const idsOf = async (query: string) => {
      const res = await authed(admin)(request(app).get(`${url(householdId)}${query}`)).expect(200);
      return (res.body.data as { id: string }[]).map((i) => i.id).sort();
    };

    assert.deepEqual(await idsOf(''), [kept]);
    assert.deepEqual(await idsOf('?includeVoided=false'), [kept]);
    assert.deepEqual(await idsOf('?includeVoided=true'), [kept, voided].sort());
    const invalid = await authed(admin)(
      request(app).get(`${url(householdId)}?includeVoided=maybe`),
    );
    assert.equal(invalid.status, 422);
  });
});
