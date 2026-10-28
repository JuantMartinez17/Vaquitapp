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
  `/api/v1/households/${householdId}/transfers${suffix}`;

const authed = (user: TestUser) => (req: request.Test) =>
  req.set('Authorization', `Bearer ${user.accessToken}`).set('Idempotency-Key', randomUUID());

/** admin, two parties and a bystander who is neither. */
const setup = async () => {
  const admin = await registerTestUser(app);
  const householdId = await createTestHousehold(app, admin);
  const from = await addTestMember(app, admin, householdId);
  const to = await addTestMember(app, admin, householdId);
  const bystander = await addTestMember(app, admin, householdId);
  return { admin, from, to, bystander, householdId };
};

const createTransfer = async (
  creator: TestUser,
  householdId: string,
  parties: { from: TestUser; to: TestUser },
) => {
  const res = await authed(creator)(request(app).post(url(householdId)))
    .send({
      fromUser: parties.from.id,
      toUser: parties.to.id,
      amount: '80.00',
      currencyCode: 'ARS',
      transferDate: '2026-01-10',
    })
    .expect(201);
  return res.body.id as string;
};

describe('transfers: voiding', () => {
  it('voids exactly once when requests race', async () => {
    const { from, to, householdId } = await setup();
    const id = await createTransfer(from, householdId, { from, to });

    const responses = await Promise.all(
      Array.from({ length: 4 }, () =>
        authed(from)(request(app).delete(url(householdId, `/${id}`))),
      ),
    );

    assert.deepEqual(responses.map((res) => res.status).sort(), [204, 409, 409, 409]);
    for (const loser of responses.filter((res) => res.status === 409)) {
      assert.equal(loser.body.error.code, 'TRANSFER_ALREADY_VOIDED');
    }
  });

  it('lets either party void it', async () => {
    const { from, to, householdId } = await setup();
    const byPayer = await createTransfer(from, householdId, { from, to });
    const byReceiver = await createTransfer(from, householdId, { from, to });

    await authed(from)(request(app).delete(url(householdId, `/${byPayer}`))).expect(204);
    await authed(to)(request(app).delete(url(householdId, `/${byReceiver}`))).expect(204);
  });

  it('lets a household admin void a transfer they are not a party to', async () => {
    const { admin, from, to, householdId } = await setup();
    const id = await createTransfer(from, householdId, { from, to });

    await authed(admin)(request(app).delete(url(householdId, `/${id}`))).expect(204);
  });

  it('forbids a plain member who is not a party from voiding it', async () => {
    const { from, to, bystander, householdId } = await setup();
    const id = await createTransfer(from, householdId, { from, to });

    const res = await authed(bystander)(request(app).delete(url(householdId, `/${id}`))).expect(
      403,
    );
    assert.equal(res.body.error.code, 'FORBIDDEN');

    const stored = await prisma.transfer.findUniqueOrThrow({ where: { id } });
    assert.equal(stored.voidedAt, null);
  });

  it('answers 404 for a transfer of another household', async () => {
    const { admin, from, to, householdId } = await setup();
    const otherHouseholdId = await createTestHousehold(app, admin);
    const id = await createTransfer(from, householdId, { from, to });

    await authed(admin)(request(app).delete(url(otherHouseholdId, `/${id}`))).expect(404);
  });
});

describe('transfers: reading', () => {
  it('returns one transfer by id, voided or not', async () => {
    const { from, to, bystander, householdId } = await setup();
    const id = await createTransfer(from, householdId, { from, to });

    const found = await authed(bystander)(request(app).get(url(householdId, `/${id}`))).expect(200);
    assert.equal(found.body.id, id);
    assert.equal(found.body.voided, false);

    await authed(from)(request(app).delete(url(householdId, `/${id}`))).expect(204);
    const voided = await authed(from)(request(app).get(url(householdId, `/${id}`))).expect(200);
    assert.equal(voided.body.voided, true);
  });

  it('answers 404 by id for unknown ids and other households, and 403 to outsiders', async () => {
    const { admin, from, to, householdId } = await setup();
    const otherHouseholdId = await createTestHousehold(app, admin);
    const outsider = await registerTestUser(app);
    const id = await createTransfer(from, householdId, { from, to });

    await authed(from)(request(app).get(url(householdId, `/${randomUUID()}`))).expect(404);
    await authed(admin)(request(app).get(url(otherHouseholdId, `/${id}`))).expect(404);
    await authed(outsider)(request(app).get(url(householdId, `/${id}`))).expect(403);
    await authed(from)(request(app).get(url(householdId, '/not-a-uuid'))).expect(422);
  });

  it('hides voided transfers from the list unless includeVoided=true', async () => {
    const { from, to, householdId } = await setup();
    const kept = await createTransfer(from, householdId, { from, to });
    const voided = await createTransfer(from, householdId, { from, to });
    await authed(from)(request(app).delete(url(householdId, `/${voided}`))).expect(204);

    const idsOf = async (query: string) => {
      const res = await authed(from)(request(app).get(`${url(householdId)}${query}`)).expect(200);
      return (res.body.data as { id: string }[]).map((t) => t.id).sort();
    };

    assert.deepEqual(await idsOf(''), [kept]);
    assert.deepEqual(await idsOf('?includeVoided=false'), [kept]);
    assert.deepEqual(await idsOf('?includeVoided=true'), [kept, voided].sort());
    const invalid = await authed(from)(request(app).get(`${url(householdId)}?includeVoided=maybe`));
    assert.equal(invalid.status, 422);
  });
});
