import { randomUUID } from 'node:crypto';
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from '../../app/app.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { registerTestUser, createTestHousehold, addTestMember } from '../testing/http.js';
import type { TestUser } from '../testing/http.js';

after(async () => {
  await prisma.$disconnect();
});

/**
 * Hostile input must be answered with a 4xx, never a 500: each case below
 * used to reach the database (or an `Invalid Date`) and blow up there.
 */

const base = (householdId: string, path: string) => `/api/v1/households/${householdId}/${path}`;

const post = (user: TestUser, url: string, body: object) =>
  request(app)
    .post(url)
    .set('Authorization', `Bearer ${user.accessToken}`)
    .set('Idempotency-Key', randomUUID())
    .send(body);

const get = (user: TestUser, url: string) =>
  request(app).get(url).set('Authorization', `Bearer ${user.accessToken}`);

const patch = (user: TestUser, url: string, body: object) =>
  request(app).patch(url).set('Authorization', `Bearer ${user.accessToken}`).send(body);

const setupHousehold = async () => {
  const admin = await registerTestUser(app);
  const householdId = await createTestHousehold(app, admin);
  const member = await addTestMember(app, admin, householdId);
  return { admin, member, householdId };
};

const expenseBody = (admin: TestUser, overrides: Record<string, unknown> = {}) => ({
  description: 'Validation probe',
  amount: '10.00',
  currencyCode: 'ARS',
  expenseDate: '2026-01-15',
  paidBy: admin.id,
  splitType: 'equal',
  participants: [{ userId: admin.id }],
  ...overrides,
});

const assertClientError = (status: number, label: string) =>
  assert.ok(status >= 400 && status < 500, `${label}: expected a 4xx, got ${status}`);

describe('input validation: expenses', () => {
  const invalidDates = ['2026-02-31', '2026-13-01', '2026-00-10', '2025-02-29', '0000-01-01'];
  for (const expenseDate of invalidDates) {
    it(`rejects the date ${expenseDate}`, async () => {
      const { admin, householdId } = await setupHousehold();
      const res = await post(
        admin,
        base(householdId, 'expenses'),
        expenseBody(admin, { expenseDate }),
      );
      assert.equal(res.status, 422);
      assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    });
  }

  it('accepts a leap day', async () => {
    const { admin, householdId } = await setupHousehold();
    await post(
      admin,
      base(householdId, 'expenses'),
      expenseBody(admin, { expenseDate: '2028-02-29' }),
    ).expect(201);
  });

  const invalidAmounts = ['99999999999999.00', '1000000000000.00', '10.123', '-5.00', '1e3', ''];
  for (const amount of invalidAmounts) {
    it(`rejects the amount "${amount}"`, async () => {
      const { admin, householdId } = await setupHousehold();
      const res = await post(admin, base(householdId, 'expenses'), expenseBody(admin, { amount }));
      assert.equal(res.status, 422);
    });
  }

  it('accepts the largest representable amount', async () => {
    const { admin, householdId } = await setupHousehold();
    const res = await post(
      admin,
      base(householdId, 'expenses'),
      expenseBody(admin, { amount: '999999999999.99' }),
    ).expect(201);
    assert.equal(res.body.amount, '999999999999.99');
  });

  it('rejects duplicate participants instead of failing on the unique index', async () => {
    const { admin, householdId } = await setupHousehold();
    const res = await post(
      admin,
      base(householdId, 'expenses'),
      expenseBody(admin, { participants: [{ userId: admin.id }, { userId: admin.id }] }),
    );
    assert.equal(res.status, 422);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  });

  it('caps the number of participants', async () => {
    const { admin, householdId } = await setupHousehold();
    const participants = Array.from({ length: 51 }, () => ({ userId: randomUUID() }));
    const res = await post(
      admin,
      base(householdId, 'expenses'),
      expenseBody(admin, { participants }),
    );
    assert.equal(res.status, 422);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  });

  it('rejects a share count that overflows the integer column', async () => {
    const { admin, householdId } = await setupHousehold();
    const res = await post(
      admin,
      base(householdId, 'expenses'),
      expenseBody(admin, {
        splitType: 'shares',
        participants: [{ userId: admin.id, shares: 3e9 }],
      }),
    );
    assert.equal(res.status, 422);
  });

  it('rejects an oversized per-participant amount', async () => {
    const { admin, householdId } = await setupHousehold();
    const res = await post(
      admin,
      base(householdId, 'expenses'),
      expenseBody(admin, {
        splitType: 'exact',
        participants: [{ userId: admin.id, amount: '99999999999999.00' }],
      }),
    );
    assert.equal(res.status, 422);
  });

  it('rejects a NUL character in free text, which Postgres cannot store', async () => {
    const { admin, householdId } = await setupHousehold();
    const description = await post(
      admin,
      base(householdId, 'expenses'),
      expenseBody(admin, { description: 'bad\u0000text' }),
    );
    assertClientError(description.status, 'description');
    const notes = await post(
      admin,
      base(householdId, 'expenses'),
      expenseBody(admin, { notes: 'bad\u0000text' }),
    );
    assertClientError(notes.status, 'notes');
  });

  it('rejects a non-UUID cursor and a malformed date filter on the list', async () => {
    const { admin, householdId } = await setupHousehold();
    const cursor = await get(admin, `${base(householdId, 'expenses')}?cursor=not-a-uuid`);
    assert.equal(cursor.status, 422);
    const from = await get(admin, `${base(householdId, 'expenses')}?from=2026-02-31`);
    assert.equal(from.status, 422);
  });

  it('treats an unknown but well-formed cursor as an empty page', async () => {
    const { admin, householdId } = await setupHousehold();
    const res = await get(admin, `${base(householdId, 'expenses')}?cursor=${randomUUID()}`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data, []);
  });

  it('applies the same checks when updating an expense', async () => {
    const { admin, householdId } = await setupHousehold();
    const created = await post(admin, base(householdId, 'expenses'), expenseBody(admin)).expect(
      201,
    );
    const url = `${base(householdId, 'expenses')}/${created.body.id}`;

    const badDate = await patch(admin, url, { expenseDate: '2026-02-31' });
    assert.equal(badDate.status, 422);
    const badAmount = await patch(admin, url, {
      amount: '99999999999999.00',
      splitType: 'equal',
      participants: [{ userId: admin.id }],
    });
    assert.equal(badAmount.status, 422);
    const duplicates = await patch(admin, url, {
      amount: '10.00',
      splitType: 'equal',
      participants: [{ userId: admin.id }, { userId: admin.id }],
    });
    assert.equal(duplicates.status, 422);
  });
});

describe('input validation: settlements, transfers and incomes', () => {
  it('rejects bad dates and amounts on a settlement', async () => {
    const { admin, member, householdId } = await setupHousehold();
    const body = (overrides: Record<string, unknown>) => ({
      fromUser: member.id,
      toUser: admin.id,
      amount: '10.00',
      currencyCode: 'ARS',
      settlementDate: '2026-01-01',
      ...overrides,
    });
    for (const overrides of [
      { settlementDate: '2026-02-31' },
      { amount: '99999999999999.00' },
      { amount: '1.234' },
      { notes: 'x\u0000y' },
      { notes: 'n'.repeat(2001) },
    ]) {
      const res = await post(admin, base(householdId, 'settlements'), body(overrides));
      assert.equal(res.status, 422, JSON.stringify(overrides));
    }
    const cursor = await get(admin, `${base(householdId, 'settlements')}?cursor=nope`);
    assert.equal(cursor.status, 422);
  });

  it('rejects bad dates and amounts on a transfer', async () => {
    const { admin, member, householdId } = await setupHousehold();
    const body = (overrides: Record<string, unknown>) => ({
      fromUser: admin.id,
      toUser: member.id,
      amount: '10.00',
      currencyCode: 'ARS',
      transferDate: '2026-01-01',
      ...overrides,
    });
    for (const overrides of [
      { transferDate: '2026-13-01' },
      { amount: '99999999999999.00' },
      { amount: '1.234' },
      { notes: 'x\u0000y' },
    ]) {
      const res = await post(admin, base(householdId, 'transfers'), body(overrides));
      assert.equal(res.status, 422, JSON.stringify(overrides));
    }
    const cursor = await get(admin, `${base(householdId, 'transfers')}?cursor=nope`);
    assert.equal(cursor.status, 422);
  });

  it('rejects bad dates and amounts on an income, on create and update', async () => {
    const { admin, householdId } = await setupHousehold();
    const body = (overrides: Record<string, unknown>) => ({
      receivedBy: admin.id,
      description: 'Salary',
      amount: '10.00',
      currencyCode: 'ARS',
      incomeDate: '2026-01-01',
      ...overrides,
    });
    for (const overrides of [
      { incomeDate: '2026-04-31' },
      { amount: '99999999999999.00' },
      { description: 'x\u0000y' },
    ]) {
      const res = await post(admin, base(householdId, 'incomes'), body(overrides));
      assert.equal(res.status, 422, JSON.stringify(overrides));
    }

    const created = await post(admin, base(householdId, 'incomes'), body({})).expect(201);
    const url = `${base(householdId, 'incomes')}/${created.body.id}`;
    assert.equal((await patch(admin, url, { incomeDate: '2026-02-30' })).status, 422);
    assert.equal((await patch(admin, url, { amount: '99999999999999.00' })).status, 422);

    const cursor = await get(admin, `${base(householdId, 'incomes')}?cursor=nope`);
    assert.equal(cursor.status, 422);
  });
});

describe('input validation: invitations, categories and users', () => {
  it('rejects an invited email longer than the column', async () => {
    const { admin, householdId } = await setupHousehold();
    const email = `${'a'.repeat(250)}@example.test`;
    const res = await post(admin, base(householdId, 'invitations'), { invitedEmail: email });
    assert.equal(res.status, 422);
  });

  it('rejects an over-long invitation token instead of querying with it', async () => {
    const user = await registerTestUser(app);
    const res = await request(app)
      .post(`/api/v1/invitations/${'t'.repeat(500)}/accept`)
      .set('Authorization', `Bearer ${user.accessToken}`);
    assert.equal(res.status, 422);
  });

  it('rejects NUL characters in category and profile text', async () => {
    const { admin, householdId } = await setupHousehold();
    const category = await post(admin, base(householdId, 'categories'), { name: 'bad\u0000name' });
    assertClientError(category.status, 'category');
    const profile = await patch(admin, '/api/v1/users/me', { displayName: 'bad\u0000name' });
    assertClientError(profile.status, 'profile');
  });

  it('rejects an avatar URL that is not http(s)', async () => {
    const user = await registerTestUser(app);
    const res = await patch(user, '/api/v1/users/me', { avatarUrl: 'javascript:alert(1)' });
    assert.equal(res.status, 422);
  });
});
