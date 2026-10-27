import { randomUUID } from 'node:crypto';
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { app } from '../../app/app.js';
import { errorMiddleware } from '../../app/middleware/error.middleware.js';
import { createRateLimiter } from '../../app/middleware/rate-limit.middleware.js';
import { createUploadConcurrencyLimiter } from '../../modules/attachments/upload-concurrency.middleware.js';
import { createHealthRouter } from '../health/health.routes.js';
import { resolveRequestId } from '../logging/request-logging.js';
import { prisma } from '../database/prisma.js';
import { createContractChecker, type ObservedResponse } from '../../shared/testing/contract.js';
import { routes } from './openapi.spec.js';
import { HealthNotReady } from './response-schemas.js';

/**
 * Proves the OpenAPI document does not lie: it drives the real app through
 * representative flows and parses every response body with the strict schema
 * its operation declares (see shared/testing/contract.ts). A missing field,
 * an extra field, an undocumented status or an undeclared error code fails.
 */

after(async () => {
  await prisma.$disconnect();
});

const contract = createContractChecker(routes);

/** What app.ts does first for every request; the mini apps below need it too. */
const withRequestId: express.RequestHandler = (req, res, next) => {
  resolveRequestId(req, res);
  next();
};

const observe = (res: request.Response): ObservedResponse => ({
  status: res.status,
  body: res.body,
  text: res.text ?? '',
  headers: res.headers,
});

/** Runs a request and checks it against the operation's declared contract. */
const call = async (
  operationId: string,
  req: request.Test,
  options?: { allowEmpty?: boolean; token?: string; idempotencyKey?: string | false },
): Promise<request.Response> => {
  if (options?.token) {
    req.set('Authorization', `Bearer ${options.token}`);
  }
  if (options?.idempotencyKey !== false && req.method === 'POST') {
    req.set('Idempotency-Key', options?.idempotencyKey ?? randomUUID());
  }
  const res = await req;
  contract.check(operationId, observe(res), options);
  return res;
};

const api = {
  get: (path: string) => request(app).get(`/api/v1${path}`),
  post: (path: string) => request(app).post(`/api/v1${path}`),
  patch: (path: string) => request(app).patch(`/api/v1${path}`),
  delete: (path: string) => request(app).delete(`/api/v1${path}`),
};

const unique = (label: string) => `${label}_${randomUUID().replace(/-/g, '')}`;

interface Person {
  id: string;
  email: string;
  username: string;
  accessToken: string;
  refreshToken: string;
}

const registerPerson = async (label: string): Promise<Person> => {
  const username = unique(label);
  const email = `${username}@example.test`;
  const res = await call(
    'registerUser',
    api.post('/auth/register').send({
      email,
      username,
      password: 'Sup3rSecret!',
      displayName: `Person ${label}`,
    }),
  );
  assert.equal(res.status, 201);
  return {
    id: res.body.user.id,
    email,
    username,
    accessToken: res.body.accessToken,
    refreshToken: res.body.refreshToken,
  };
};

const PNG_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('contract-test-png-body'),
]);

describe('OpenAPI contract: real responses match the declared schemas', () => {
  let admin: Person;
  let bob: Person;
  let carol: Person;
  let dave: Person;
  let householdId: string;
  const base = () => `/households/${householdId}`;

  // Filled in by earlier steps and used by later ones.
  let equalExpenseId: string;
  let exactExpenseId: string;
  let sharesExpenseId: string;
  let settlementId: string;
  let incomeId: string;
  let transferId: string;
  let categoryId: string;

  it('serves health and static catalogs without authentication', async () => {
    const live = await request(app).get('/health').expect(200);
    contract.check('getHealth', observe(live));
    const ready = await request(app).get('/health/ready').expect(200);
    contract.check('getReadiness', observe(ready));

    await call('listCurrencies', api.get('/currencies'));
    await call('listGlobalCategories', api.get('/categories'));
  });

  it('answers a failing readiness probe with the documented 503 body', async () => {
    const miniApp = express();
    miniApp.use(withRequestId);
    miniApp.use(
      createHealthRouter({
        probe: () => Promise.reject(new Error('db down')),
      }),
    );
    const res = await request(miniApp).get('/health/ready').expect(503);
    contract.check('getReadiness', observe(res));
    assert.deepEqual(res.body, { status: 'not ready', database: 'disconnected' });
    HealthNotReady.parse(res.body);
  });

  it('registers, logs in, refreshes and logs out', async () => {
    admin = await registerPerson('admin');
    bob = await registerPerson('bob');
    carol = await registerPerson('carol');
    dave = await registerPerson('dave');

    const login = await call(
      'loginUser',
      api.post('/auth/login').send({ email: admin.email, password: 'Sup3rSecret!' }),
    );
    assert.equal(login.status, 200);

    const throwaway = await registerPerson('throwaway');
    const refreshed = await call(
      'refreshTokens',
      api.post('/auth/refresh').send({ refreshToken: throwaway.refreshToken }),
    );
    assert.equal(refreshed.status, 200);
    // The rotated-out token is a reuse: the whole family of sessions is revoked.
    const reuse = await call(
      'refreshTokens',
      api.post('/auth/refresh').send({ refreshToken: throwaway.refreshToken }),
    );
    assert.equal(reuse.status, 401);
    assert.equal(reuse.body.error.code, 'TOKEN_REUSE_DETECTED');

    const second = await call(
      'loginUser',
      api.post('/auth/login').send({ email: throwaway.email, password: 'Sup3rSecret!' }),
    );
    const out = await call(
      'logout',
      api.post('/auth/logout').send({ refreshToken: second.body.refreshToken }),
    );
    assert.equal(out.status, 204);
    const outAll = await call('logoutAll', api.post('/auth/logout-all'), {
      token: second.body.accessToken,
    });
    assert.equal(outAll.status, 204);
  });

  it('documents the auth and request-parsing errors it can return', async () => {
    const wrongPassword = await call(
      'loginUser',
      api.post('/auth/login').send({ email: admin.email, password: 'not-the-password' }),
    );
    assert.equal(wrongPassword.body.error.code, 'INVALID_CREDENTIALS');

    const duplicateEmail = await call(
      'registerUser',
      api.post('/auth/register').send({
        email: admin.email,
        username: unique('other'),
        password: 'Sup3rSecret!',
      }),
    );
    assert.equal(duplicateEmail.body.error.code, 'EMAIL_ALREADY_REGISTERED');

    const takenUsername = await call(
      'registerUser',
      api.post('/auth/register').send({
        email: `${unique('free')}@example.test`,
        username: admin.username,
        password: 'Sup3rSecret!',
      }),
    );
    assert.equal(takenUsername.body.error.code, 'USERNAME_TAKEN');

    const invalid = await call(
      'registerUser',
      api.post('/auth/register').send({ email: 'nope', unknownField: 1 }),
    );
    assert.equal(invalid.status, 422);
    assert.ok(Array.isArray(invalid.body.error.details.formErrors), 'formErrors is documented');

    const malformed = await call(
      'registerUser',
      api.post('/auth/register').set('Content-Type', 'application/json').send('{"email":'),
    );
    assert.equal(malformed.status, 400);
    assert.equal(malformed.body.error.code, 'BAD_REQUEST');

    const tooLarge = await call(
      'registerUser',
      api
        .post('/auth/register')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ displayName: 'x'.repeat(1_100_000) })),
    );
    assert.equal(tooLarge.status, 413);
    assert.equal(tooLarge.body.error.code, 'PAYLOAD_TOO_LARGE');

    const unauthenticated = await call('getCurrentUser', api.get('/users/me'));
    assert.equal(unauthenticated.body.error.code, 'UNAUTHORIZED');
  });

  it('reads and updates the current user', async () => {
    const me = await call('getCurrentUser', api.get('/users/me'), { token: admin.accessToken });
    assert.equal(me.body.id, admin.id);
    const updated = await call(
      'updateCurrentUser',
      api
        .patch('/users/me')
        .send({ displayName: 'Admin Person', avatarUrl: 'https://example.test/a.png' }),
      { token: admin.accessToken },
    );
    assert.equal(updated.body.avatarUrl, 'https://example.test/a.png');
    const unsupported = await call(
      'updateCurrentUser',
      api.patch('/users/me').send({ preferredCurrencyCode: 'ZZZ' }),
      { token: admin.accessToken },
    );
    assert.equal(unsupported.status, 400);
  });

  it('creates a household and manages invitations and members', async () => {
    const created = await call(
      'createHousehold',
      api.post('/households').send({ name: 'Contract House', description: 'Docs must not lie' }),
      { token: admin.accessToken },
    );
    householdId = created.body.id;
    assert.equal(created.body.role, 'admin');

    const second = await call(
      'createHousehold',
      api.post('/households').send({ name: 'Throwaway' }),
      {
        token: admin.accessToken,
      },
    );
    await call('deleteHousehold', api.delete(`/households/${second.body.id}`), {
      token: admin.accessToken,
    });

    await call('listHouseholds', api.get('/households'), { token: admin.accessToken });
    await call('getHousehold', api.get(base()), { token: admin.accessToken });
    const renamed = await call('updateHousehold', api.patch(base()).send({ name: 'Renamed' }), {
      token: admin.accessToken,
    });
    assert.equal(renamed.body.role, undefined, 'update omits role, as documented as optional');

    // Bob: invited, sees it in his list, accepts.
    const invite = await call(
      'createInvitation',
      api.post(`${base()}/invitations`).send({ invitedEmail: bob.email }),
      { token: admin.accessToken },
    );
    const mine = await call('listMyInvitations', api.get('/users/me/invitations'), {
      token: bob.accessToken,
    });
    assert.equal(mine.body[0].status, 'pending');
    const accepted = await call(
      'acceptInvitation',
      api.post(`/invitations/${invite.body.token}/accept`),
      {
        token: bob.accessToken,
      },
    );
    assert.equal(accepted.body.role, 'member');
    const again = await call(
      'acceptInvitation',
      api.post(`/invitations/${invite.body.token}/accept`),
      {
        token: bob.accessToken,
      },
    );
    assert.equal(again.status, 409);

    // Carol: rejects, is invited again, accepts. Dave joins and is removed.
    const carolFirst = await call(
      'createInvitation',
      api.post(`${base()}/invitations`).send({ invitedEmail: carol.email }),
      { token: admin.accessToken },
    );
    const duplicate = await call(
      'createInvitation',
      api.post(`${base()}/invitations`).send({ invitedEmail: carol.email }),
      { token: admin.accessToken },
    );
    assert.equal(duplicate.body.error.code, 'INVITATION_ALREADY_PENDING');
    const rejected = await call(
      'rejectInvitation',
      api.post(`/invitations/${carolFirst.body.token}/reject`),
      {
        token: carol.accessToken,
      },
    );
    assert.equal(rejected.status, 204);
    const carolSecond = await call(
      'createInvitation',
      api.post(`${base()}/invitations`).send({ invitedEmail: carol.email }),
      { token: admin.accessToken },
    );
    await call('acceptInvitation', api.post(`/invitations/${carolSecond.body.token}/accept`), {
      token: carol.accessToken,
    });

    const daveInvite = await call(
      'createInvitation',
      api.post(`${base()}/invitations`).send({ invitedEmail: dave.email }),
      { token: admin.accessToken },
    );
    const stranger = await call(
      'acceptInvitation',
      api.post(`/invitations/${daveInvite.body.token}/accept`),
      {
        token: carol.accessToken,
      },
    );
    assert.equal(stranger.status, 403);
    await call('acceptInvitation', api.post(`/invitations/${daveInvite.body.token}/accept`), {
      token: dave.accessToken,
    });

    const spare = await call(
      'createInvitation',
      api.post(`${base()}/invitations`).send({ invitedEmail: `${unique('spare')}@example.test` }),
      { token: admin.accessToken },
    );
    const listed = await call('listInvitations', api.get(`${base()}/invitations`), {
      token: admin.accessToken,
    });
    assert.ok(listed.body.some((entry: { status: string }) => entry.status === 'accepted'));
    const revoked = await call(
      'revokeInvitation',
      api.delete(`${base()}/invitations/${spare.body.id}`),
      { token: admin.accessToken },
    );
    assert.equal(revoked.status, 204);

    const members = await call('listMembers', api.get(`${base()}/members`), {
      token: admin.accessToken,
    });
    assert.equal(members.body.length, 4);

    const promoted = await call(
      'updateMemberRole',
      api.patch(`${base()}/members/${bob.id}`).send({ role: 'admin' }),
      { token: admin.accessToken },
    );
    assert.equal(promoted.body.role, 'admin');
    await call(
      'updateMemberRole',
      api.patch(`${base()}/members/${bob.id}`).send({ role: 'member' }),
      {
        token: admin.accessToken,
      },
    );
    const lastAdmin = await call(
      'updateMemberRole',
      api.patch(`${base()}/members/${admin.id}`).send({ role: 'member' }),
      { token: admin.accessToken },
    );
    assert.equal(lastAdmin.body.error.code, 'LAST_ADMIN');
    const leaveLastAdmin = await call('leaveHousehold', api.post(`${base()}/members/leave`), {
      token: admin.accessToken,
    });
    assert.equal(leaveLastAdmin.body.error.code, 'LAST_ADMIN');

    const removed = await call('removeMember', api.delete(`${base()}/members/${dave.id}`), {
      token: admin.accessToken,
    });
    assert.equal(removed.status, 204);
    const notAdmin = await call('removeMember', api.delete(`${base()}/members/${bob.id}`), {
      token: bob.accessToken,
    });
    assert.equal(notAdmin.body.error.code, 'INSUFFICIENT_ROLE');
  });

  it('manages categories', async () => {
    await call('listHouseholdCategories', api.get(`${base()}/categories`), {
      token: bob.accessToken,
    });
    const created = await call(
      'createCategory',
      api.post(`${base()}/categories`).send({ name: 'Groceries', icon: 'cart', color: '#FFAA00' }),
      { token: admin.accessToken },
    );
    categoryId = created.body.id;
    const bare = await call(
      'createCategory',
      api.post(`${base()}/categories`).send({ name: 'No icon' }),
      { token: admin.accessToken },
    );
    assert.equal(bare.body.icon, null);
    await call(
      'updateCategory',
      api.patch(`${base()}/categories/${categoryId}`).send({ name: 'Supermarket' }),
      { token: admin.accessToken },
    );
    const global = await api.get('/categories');
    const system = await call(
      'updateCategory',
      api.patch(`${base()}/categories/${global.body[0].id}`).send({ name: 'Hijack' }),
      { token: admin.accessToken },
    );
    assert.equal(system.body.error.code, 'FORBIDDEN');
    const deleted = await call(
      'deleteCategory',
      api.delete(`${base()}/categories/${bare.body.id}`),
      { token: admin.accessToken },
    );
    assert.equal(deleted.status, 204);
  });

  it('creates expenses with every split type and reads them back', async () => {
    const equalKey = randomUUID();
    const equalBody = {
      description: 'Dinner',
      notes: 'Split in two',
      amount: '100.00',
      currencyCode: 'ARS',
      expenseDate: '2026-08-10',
      categoryId,
      paidBy: admin.id,
      splitType: 'equal',
      participants: [{ userId: admin.id }, { userId: bob.id }],
    };
    const equal = await call('createExpense', api.post(`${base()}/expenses`).send(equalBody), {
      token: admin.accessToken,
      idempotencyKey: equalKey,
    });
    equalExpenseId = equal.body.id;
    assert.equal(equal.body.category.id, categoryId);

    // Replay: same status and body, flagged by the documented header.
    const replay = await call('createExpense', api.post(`${base()}/expenses`).send(equalBody), {
      token: admin.accessToken,
      idempotencyKey: equalKey,
    });
    assert.equal(replay.headers['idempotency-replayed'], 'true');
    assert.deepEqual(replay.body, equal.body);

    const conflict = await call(
      'createExpense',
      api.post(`${base()}/expenses`).send({ ...equalBody, amount: '101.00' }),
      { token: admin.accessToken, idempotencyKey: equalKey },
    );
    assert.equal(conflict.body.error.code, 'IDEMPOTENCY_KEY_CONFLICT');

    const noKey = await call('createExpense', api.post(`${base()}/expenses`).send(equalBody), {
      token: admin.accessToken,
      idempotencyKey: false,
    });
    assert.equal(noKey.status, 400);

    const exact = await call(
      'createExpense',
      api.post(`${base()}/expenses`).send({
        description: 'Rent',
        amount: '300.50',
        currencyCode: 'ARS',
        expenseDate: '2026-08-11',
        paidBy: bob.id,
        splitType: 'exact',
        participants: [
          { userId: admin.id, amount: '100.50' },
          { userId: bob.id, amount: '200.00' },
        ],
      }),
      { token: bob.accessToken },
    );
    exactExpenseId = exact.body.id;
    assert.equal(exact.body.notes, null);
    assert.equal(exact.body.category, null);

    const percentage = await call(
      'createExpense',
      api.post(`${base()}/expenses`).send({
        description: 'Internet',
        amount: '50.00',
        currencyCode: 'ARS',
        expenseDate: '2026-08-12',
        paidBy: admin.id,
        splitType: 'percentage',
        participants: [
          { userId: admin.id, percentage: 33.33 },
          { userId: bob.id, percentage: 66.67 },
        ],
      }),
      { token: admin.accessToken },
    );
    assert.ok(
      percentage.body.splits.every((split: { percentage: string | null }) => split.percentage),
    );

    const shares = await call(
      'createExpense',
      api.post(`${base()}/expenses`).send({
        description: 'Cleaning',
        amount: '90.00',
        currencyCode: 'ARS',
        expenseDate: '2026-08-13',
        paidBy: admin.id,
        splitType: 'shares',
        participants: [
          { userId: admin.id, shares: 1 },
          { userId: bob.id, shares: 2 },
        ],
      }),
      { token: admin.accessToken },
    );
    sharesExpenseId = shares.body.id;
    assert.deepEqual(
      shares.body.splits.map((split: { shares: number }) => split.shares).sort(),
      [1, 2],
    );

    const badSplit = await call(
      'createExpense',
      api.post(`${base()}/expenses`).send({
        ...equalBody,
        splitType: 'exact',
        participants: [{ userId: admin.id, amount: '1.00' }],
      }),
      { token: admin.accessToken },
    );
    assert.equal(badSplit.body.error.code, 'INVALID_EXPENSE_SPLIT');
    assert.deepEqual(Object.keys(badSplit.body.error.details).sort(), ['expected', 'received']);

    const notMember = await call(
      'createExpense',
      api.post(`${base()}/expenses`).send({ ...equalBody, paidBy: randomUUID() }),
      { token: admin.accessToken },
    );
    assert.equal(notMember.body.error.code, 'INVALID_PAYER');
  });

  it('lists, paginates, filters, edits and voids expenses', async () => {
    const first = await call('listExpenses', api.get(`${base()}/expenses?limit=2`), {
      token: admin.accessToken,
    });
    assert.equal(first.body.data.length, 2);
    assert.equal(typeof first.body.nextCursor, 'string');
    const second = await call(
      'listExpenses',
      api.get(`${base()}/expenses?limit=2&cursor=${first.body.nextCursor}`),
      { token: admin.accessToken },
    );
    assert.equal(second.body.data.length, 2);
    assert.equal(second.body.nextCursor, null);

    await call(
      'listExpenses',
      api.get(
        `${base()}/expenses?from=2026-08-11&to=2026-08-12&paidBy=${admin.id}&participantId=${bob.id}`,
      ),
      { token: admin.accessToken },
    );
    const badCursor = await call('listExpenses', api.get(`${base()}/expenses?cursor=not-a-uuid`), {
      token: admin.accessToken,
    });
    assert.equal(badCursor.status, 422);

    await call('getExpense', api.get(`${base()}/expenses/${equalExpenseId}`), {
      token: bob.accessToken,
    });
    const missing = await call('getExpense', api.get(`${base()}/expenses/${randomUUID()}`), {
      token: bob.accessToken,
    });
    assert.equal(missing.body.error.code, 'NOT_FOUND');

    const edited = await call(
      'updateExpense',
      api.patch(`${base()}/expenses/${equalExpenseId}`).send({
        description: 'Dinner (edited)',
        notes: null,
        amount: '120.00',
        splitType: 'equal',
        participants: [{ userId: admin.id }, { userId: bob.id }],
      }),
      { token: admin.accessToken },
    );
    assert.equal(edited.body.amount, '120.00');
    const partial = await call(
      'updateExpense',
      api.patch(`${base()}/expenses/${equalExpenseId}`).send({ amount: '120.00' }),
      { token: admin.accessToken },
    );
    assert.equal(partial.status, 422);
    assert.ok(partial.body.error.details.formErrors.length > 0);

    const voided = await call('voidExpense', api.delete(`${base()}/expenses/${sharesExpenseId}`), {
      token: admin.accessToken,
    });
    assert.equal(voided.status, 204);
    const twice = await call('voidExpense', api.delete(`${base()}/expenses/${sharesExpenseId}`), {
      token: admin.accessToken,
    });
    assert.equal(twice.body.error.code, 'EXPENSE_ALREADY_VOIDED');
    const hidden = await api
      .get(`${base()}/expenses?limit=100`)
      .set('Authorization', `Bearer ${admin.accessToken}`);
    assert.ok(!hidden.body.data.some((expense: { id: string }) => expense.id === sharesExpenseId));
    const withVoided = await call(
      'listExpenses',
      api.get(`${base()}/expenses?limit=100&includeVoided=true`),
      { token: admin.accessToken },
    );
    assert.ok(
      withVoided.body.data.some((expense: { status: string }) => expense.status === 'voided'),
    );
    await call('listExpenses', api.get(`${base()}/expenses?status=voided`), {
      token: admin.accessToken,
    });
  });

  it('confirms and skips pending recurring occurrences', async () => {
    const recurring = await call(
      'createRecurringExpense',
      api.post(`${base()}/recurring-expenses`).send({
        description: 'Netflix',
        defaultAmount: '20.00',
        currencyCode: 'ARS',
        categoryId,
        paidBy: admin.id,
        splitType: 'equal',
        participants: [{ userId: admin.id }, { userId: bob.id }],
        frequency: 'monthly',
        dayOfMonth: 5,
        startDate: '2026-12-05',
        endDate: '2027-12-05',
      }),
      { token: admin.accessToken },
    );
    assert.equal(recurring.body.splits.length, 2);

    // Occurrences are normally generated by a scheduled job; insert two as it would.
    const pending = async (day: string) => {
      const row = await prisma.expense.create({
        data: {
          householdId,
          paidBy: admin.id,
          createdBy: admin.id,
          recurringExpenseId: recurring.body.id,
          description: 'Netflix',
          amount: '20.00',
          currencyCode: 'ARS',
          splitType: 'equal',
          expenseDate: new Date(day),
          status: 'pending',
          splits: {
            create: [
              { userId: admin.id, amount: '10.00' },
              { userId: bob.id, amount: '10.00' },
            ],
          },
        },
      });
      return row.id;
    };
    const toConfirm = await pending('2026-09-05');
    const toSkip = await pending('2026-10-05');

    const confirmed = await call(
      'confirmExpense',
      api.post(`${base()}/expenses/${toConfirm}/confirm`),
      {
        token: admin.accessToken,
      },
    );
    assert.equal(confirmed.body.status, 'active');
    const notPending = await call(
      'confirmExpense',
      api.post(`${base()}/expenses/${toConfirm}/confirm`),
      {
        token: admin.accessToken,
      },
    );
    assert.equal(notPending.body.error.code, 'RECURRING_OCCURRENCE_NOT_PENDING');
    const skipped = await call('skipExpense', api.post(`${base()}/expenses/${toSkip}/skip`), {
      token: admin.accessToken,
    });
    assert.equal(skipped.status, 204);

    await call('listRecurringExpenses', api.get(`${base()}/recurring-expenses`), {
      token: bob.accessToken,
    });
    const upcoming = await call(
      'listUpcomingRecurringExpenses',
      api.get(`${base()}/recurring-expenses/upcoming`),
      { token: bob.accessToken },
    );
    assert.equal(upcoming.body[0].overdue, false);
    const patched = await call(
      'updateRecurringExpense',
      api
        .patch(`${base()}/recurring-expenses/${recurring.body.id}`)
        .send({ isActive: false, endDate: null }),
      { token: admin.accessToken },
    );
    assert.equal(patched.body.isActive, false);
    const removed = await call(
      'deleteRecurringExpense',
      api.delete(`${base()}/recurring-expenses/${recurring.body.id}`),
      { token: admin.accessToken },
    );
    assert.equal(removed.status, 204);
  });

  it('records settlements, incomes and transfers', async () => {
    const settlement = await call(
      'createSettlement',
      api.post(`${base()}/settlements`).send({
        fromUser: bob.id,
        toUser: admin.id,
        amount: '25.00',
        currencyCode: 'ARS',
        settlementDate: '2026-08-14',
        notes: 'Cash',
      }),
      { token: bob.accessToken },
    );
    settlementId = settlement.body.id;
    const forged = await call(
      'createSettlement',
      api.post(`${base()}/settlements`).send({
        fromUser: bob.id,
        toUser: admin.id,
        amount: '25.00',
        currencyCode: 'ARS',
        settlementDate: '2026-08-14',
      }),
      { token: carol.accessToken },
    );
    assert.equal(forged.body.error.code, 'FORBIDDEN');
    const doomed = await call(
      'createSettlement',
      api.post(`${base()}/settlements`).send({
        fromUser: admin.id,
        toUser: bob.id,
        amount: '5.00',
        currencyCode: 'ARS',
        settlementDate: '2026-08-15',
      }),
      { token: admin.accessToken },
    );
    await call('getSettlement', api.get(`${base()}/settlements/${settlementId}`), {
      token: carol.accessToken,
    });
    const strangerVoid = await call(
      'voidSettlement',
      api.delete(`${base()}/settlements/${doomed.body.id}`),
      { token: carol.accessToken },
    );
    assert.equal(strangerVoid.body.error.code, 'FORBIDDEN');
    await call('voidSettlement', api.delete(`${base()}/settlements/${doomed.body.id}`), {
      token: admin.accessToken,
    });
    const settlementsTwice = await call(
      'voidSettlement',
      api.delete(`${base()}/settlements/${doomed.body.id}`),
      { token: admin.accessToken },
    );
    assert.equal(settlementsTwice.body.error.code, 'SETTLEMENT_ALREADY_VOIDED');
    const visible = await call('listSettlements', api.get(`${base()}/settlements`), {
      token: admin.accessToken,
    });
    assert.equal(visible.body.data.length, 1, 'voided settlements are hidden by default');
    const all = await call('listSettlements', api.get(`${base()}/settlements?includeVoided=true`), {
      token: admin.accessToken,
    });
    assert.equal(all.body.data.length, 2);

    const income = await call(
      'createIncome',
      api.post(`${base()}/incomes`).send({
        receivedBy: admin.id,
        description: 'Salary',
        notes: 'August',
        amount: '1500.00',
        currencyCode: 'ARS',
        categoryId,
        incomeDate: '2026-08-01',
      }),
      { token: admin.accessToken },
    );
    incomeId = income.body.id;
    const bare = await call(
      'createIncome',
      api.post(`${base()}/incomes`).send({
        receivedBy: bob.id,
        description: 'Gift',
        amount: '10.00',
        currencyCode: 'ARS',
        incomeDate: '2026-08-02',
      }),
      { token: bob.accessToken },
    );
    assert.equal(bare.body.category, null);
    await call('listIncomes', api.get(`${base()}/incomes?limit=1`), { token: admin.accessToken });
    await call('getIncome', api.get(`${base()}/incomes/${incomeId}`), { token: admin.accessToken });
    const updated = await call(
      'updateIncome',
      api.patch(`${base()}/incomes/${incomeId}`).send({ amount: '1600.00', notes: null }),
      { token: admin.accessToken },
    );
    assert.equal(updated.body.amount, '1600.00');
    await call('voidIncome', api.delete(`${base()}/incomes/${bare.body.id}`), {
      token: bob.accessToken,
    });
    const voidedGet = await call('getIncome', api.get(`${base()}/incomes/${bare.body.id}`), {
      token: bob.accessToken,
    });
    assert.equal(voidedGet.body.voided, true);
    const incomeTwice = await call('voidIncome', api.delete(`${base()}/incomes/${bare.body.id}`), {
      token: bob.accessToken,
    });
    assert.equal(incomeTwice.body.error.code, 'INCOME_ALREADY_VOIDED');
    await call('listIncomes', api.get(`${base()}/incomes?includeVoided=true`), {
      token: admin.accessToken,
    });

    const transfer = await call(
      'createTransfer',
      api.post(`${base()}/transfers`).send({
        fromUser: admin.id,
        toUser: bob.id,
        amount: '40.00',
        currencyCode: 'ARS',
        transferDate: '2026-08-16',
      }),
      { token: admin.accessToken },
    );
    transferId = transfer.body.id;
    const invalidTransfer = await call(
      'createTransfer',
      api.post(`${base()}/transfers`).send({
        fromUser: admin.id,
        toUser: admin.id,
        amount: '40.00',
        currencyCode: 'ARS',
        transferDate: '2026-08-16',
      }),
      { token: admin.accessToken },
    );
    assert.equal(invalidTransfer.body.error.code, 'INVALID_TRANSFER');
    await call('listTransfers', api.get(`${base()}/transfers`), { token: admin.accessToken });
    await call('getTransfer', api.get(`${base()}/transfers/${transferId}`), {
      token: bob.accessToken,
    });
    const strangerTransfer = await call(
      'voidTransfer',
      api.delete(`${base()}/transfers/${transferId}`),
      { token: carol.accessToken },
    );
    assert.equal(strangerTransfer.body.error.code, 'FORBIDDEN');
    await call('voidTransfer', api.delete(`${base()}/transfers/${transferId}`), {
      token: bob.accessToken,
    });
    const transferTwice = await call(
      'voidTransfer',
      api.delete(`${base()}/transfers/${transferId}`),
      { token: bob.accessToken },
    );
    assert.equal(transferTwice.body.error.code, 'TRANSFER_ALREADY_VOIDED');
    await call('listTransfers', api.get(`${base()}/transfers?includeVoided=true`), {
      token: admin.accessToken,
    });
  });

  it('derives balances and the simplified debt graph, flagging former members', async () => {
    const balances = await call('getBalances', api.get(`${base()}/balances`), {
      token: admin.accessToken,
    });
    assert.ok(
      balances.body.balances.every((row: { isFormerMember: boolean }) => !row.isFormerMember),
    );
    await call('getSimplifiedBalances', api.get(`${base()}/balances/simplified`), {
      token: admin.accessToken,
    });

    const leaving = await call('leaveHousehold', api.post(`${base()}/members/leave`), {
      token: bob.accessToken,
    });
    assert.equal(leaving.status, 409);
    assert.equal(leaving.body.error.code, 'MEMBER_HAS_OPEN_BALANCE');
    assert.match(leaving.body.error.details.net, /^-?\d+\.\d{2}$/);
    const refused = await call('removeMember', api.delete(`${base()}/members/${bob.id}`), {
      token: admin.accessToken,
    });
    assert.equal(refused.body.error.code, 'MEMBER_HAS_OPEN_BALANCE');

    // Bob cannot leave with a balance, so mark him as gone directly to reach
    // the former-member branch (he still owes or is owed money).
    await prisma.householdMember.updateMany({
      where: { householdId, userId: bob.id },
      data: { leftAt: new Date() },
    });
    const former = await call('getBalances', api.get(`${base()}/balances`), {
      token: admin.accessToken,
    });
    assert.ok(former.body.balances.some((row: { isFormerMember: boolean }) => row.isFormerMember));
    const simplified = await call(
      'getSimplifiedBalances',
      api.get(`${base()}/balances/simplified`),
      {
        token: admin.accessToken,
      },
    );
    assert.ok(
      simplified.body.simplified.some(
        (row: { fromIsFormerMember: boolean; toIsFormerMember: boolean }) =>
          row.fromIsFormerMember || row.toIsFormerMember,
      ),
    );
    await prisma.householdMember.updateMany({
      where: { householdId, userId: bob.id },
      data: { leftAt: null },
    });

    // Carol has no activity, so she can leave and then loses access.
    const left = await call('leaveHousehold', api.post(`${base()}/members/leave`), {
      token: carol.accessToken,
    });
    assert.equal(left.status, 204);
    const afterLeaving = await call('listExpenses', api.get(`${base()}/expenses`), {
      token: carol.accessToken,
    });
    assert.equal(afterLeaving.body.error.code, 'NOT_A_MEMBER');
  });

  it('lists the activity feed with its opaque cursor', async () => {
    const first = await call('listActivity', api.get(`${base()}/activity?limit=3`), {
      token: admin.accessToken,
    });
    assert.equal(typeof first.body.nextCursor, 'string');
    assert.ok(
      first.body.data.every((item: { type: string }) =>
        ['expense', 'income', 'transfer', 'settlement'].includes(item.type),
      ),
    );
    await call(
      'listActivity',
      api.get(`${base()}/activity?limit=3&cursor=${encodeURIComponent(first.body.nextCursor)}`),
      { token: admin.accessToken },
    );
    const bad = await call('listActivity', api.get(`${base()}/activity?cursor=garbage`), {
      token: admin.accessToken,
    });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error.code, 'BAD_REQUEST');
  });

  it('manages attachments', async () => {
    const path = `${base()}/expenses/${exactExpenseId}/attachments`;
    const uploaded = await call(
      'uploadAttachment',
      api.post(path).attach('file', PNG_BYTES, { filename: 'receipt.png' }),
      { token: admin.accessToken, idempotencyKey: false },
    );
    assert.equal(uploaded.body.mimeType, 'image/png');
    const duplicate = await call(
      'uploadAttachment',
      api.post(path).attach('file', PNG_BYTES, { filename: 'receipt.png' }),
      { token: admin.accessToken, idempotencyKey: false },
    );
    assert.equal(duplicate.body.id, uploaded.body.id, 'identical upload returns the existing row');
    await call('listAttachments', api.get(path), { token: bob.accessToken });

    const download = await call(
      'getAttachmentDownloadUrl',
      api.get(`${path}/${uploaded.body.id}/download`),
      { token: bob.accessToken },
    );
    assert.equal(download.body.expiresInSeconds, 300);
    const file = await request(app)
      .get(download.body.url)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      });
    contract.check('downloadLocalFile', observe(file));
    assert.ok(Buffer.from(file.body as Buffer).equals(PNG_BYTES));

    const text = await call(
      'uploadAttachment',
      api.post(path).attach('file', Buffer.from('plain text, not an image'), { filename: 'a.txt' }),
      { token: admin.accessToken, idempotencyKey: false },
    );
    assert.equal(text.status, 415);
    const noFile = await call('uploadAttachment', api.post(path).field('note', 'oops'), {
      token: admin.accessToken,
      idempotencyKey: false,
    });
    assert.equal(noFile.status, 400);
    const onVoided = await call(
      'uploadAttachment',
      api
        .post(`${base()}/expenses/${sharesExpenseId}/attachments`)
        .attach('file', PNG_BYTES, { filename: 'late.png' }),
      { token: admin.accessToken, idempotencyKey: false },
    );
    assert.equal(onVoided.status, 400);

    const removed = await call('deleteAttachment', api.delete(`${path}/${uploaded.body.id}`), {
      token: admin.accessToken,
    });
    assert.equal(removed.status, 204);
    const forged = await request(app).get(
      download.body.url.replace(/signature=[0-9a-f]+/, 'signature=00'),
    );
    contract.check('downloadLocalFile', observe(forged));
    assert.equal(forged.status, 401);
  });

  it('computes analytics', async () => {
    const range = 'from=2026-08-01&to=2026-08-31';
    await call('getAnalyticsSummary', api.get(`${base()}/analytics/summary?${range}`), {
      token: admin.accessToken,
    });
    const byCategory = await call(
      'getAnalyticsByCategory',
      api.get(`${base()}/analytics/by-category?${range}`),
      { token: admin.accessToken },
    );
    assert.ok(
      byCategory.body.some((row: { categoryId: string | null }) => row.categoryId === null),
    );
    assert.ok(
      byCategory.body.some((row: { categoryId: string | null }) => row.categoryId !== null),
    );
    await call('getAnalyticsByMember', api.get(`${base()}/analytics/by-member?${range}`), {
      token: admin.accessToken,
    });
    await call('getAnalyticsOverTime', api.get(`${base()}/analytics/over-time?${range}`), {
      token: admin.accessToken,
    });
    await call(
      'getAnalyticsOverTime',
      api.get(`${base()}/analytics/over-time?${range}&granularity=month`),
      { token: admin.accessToken },
    );
    await call('getAnalyticsComparison', api.get(`${base()}/analytics/comparison?${range}`), {
      token: admin.accessToken,
    });
    const tooWide = await call(
      'getAnalyticsSummary',
      api.get(`${base()}/analytics/summary?from=2024-01-01&to=2026-01-01`),
      { token: admin.accessToken },
    );
    assert.equal(tooWide.status, 422);
    assert.ok(tooWide.body.error.details.formErrors.length > 0);
  });

  it('keeps the currency locked once there is financial activity', async () => {
    const locked = await call(
      'updateHousehold',
      api.patch(base()).send({ defaultCurrencyCode: 'USD' }),
      {
        token: admin.accessToken,
      },
    );
    assert.equal(locked.status, 409);
    assert.equal(locked.body.error.code, 'HOUSEHOLD_CURRENCY_LOCKED');
  });

  it('prints money with the currency decimals, including zero-decimal currencies', async () => {
    const clp = await call(
      'createHousehold',
      api.post('/households').send({ name: 'Chile', defaultCurrencyCode: 'CLP' }),
      { token: admin.accessToken },
    );
    const clpBase = `/households/${clp.body.id}`;
    const expense = await call(
      'createExpense',
      api.post(`${clpBase}/expenses`).send({
        description: 'Empanadas',
        amount: '8500',
        currencyCode: 'CLP',
        expenseDate: '2026-08-20',
        paidBy: admin.id,
        splitType: 'equal',
        participants: [{ userId: admin.id }],
      }),
      { token: admin.accessToken },
    );
    assert.equal(expense.body.amount, '8500');
    const balances = await call('getBalances', api.get(`${clpBase}/balances`), {
      token: admin.accessToken,
      allowEmpty: true,
    });
    assert.equal(balances.body.currencyCode, 'CLP');
  });

  it('answers a made-up household or an unknown member the way the document says', async () => {
    const stranger = await call('getHousehold', api.get(`/households/${randomUUID()}`), {
      token: admin.accessToken,
    });
    assert.equal(stranger.status, 403);
    assert.equal(stranger.body.error.code, 'NOT_A_MEMBER');
    const gone = await call('removeMember', api.delete(`${base()}/members/${randomUUID()}`), {
      token: admin.accessToken,
    });
    assert.equal(gone.status, 404);
    assert.equal(gone.body.error.code, 'NOT_A_MEMBER');
  });

  it('documents the rate-limit and capacity headers it promises', async () => {
    const limited = express();
    limited.use(withRequestId);
    limited.use(createRateLimiter({ limit: 1, windowMs: 60_000 }));
    limited.get('/ping', (_req, res) => {
      res.json({ ok: true });
    });
    limited.use(errorMiddleware);
    await request(limited).get('/ping').expect(200);
    const blocked = await request(limited).get('/ping').expect(429);
    // `getCurrentUser` declares 429 like every /api/v1 operation.
    contract.check('getCurrentUser', observe(blocked));

    const busy = express();
    busy.use(withRequestId);
    busy.post('/upload', createUploadConcurrencyLimiter(0), (_req, res) => {
      res.status(201).end();
    });
    busy.use(errorMiddleware);
    const full = await request(busy).post('/upload').expect(503);
    contract.check('uploadAttachment', observe(full));
  });

  it('exercises every operation of the document', () => {
    const missing = contract.allOperationIds.filter((id) => !contract.succeeded.has(id));
    assert.deepEqual(missing, [], `operations never answered with their declared 2xx: ${missing}`);
  });
});
