import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { app } from '../../app/app.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { AppError } from '../../shared/errors/errors.js';
import { ErrorCode } from '../../shared/errors/codes.js';
import { registerTestUser, createTestHousehold, addTestMember } from '../../shared/testing/http.js';
import { confirmExpense, createExpense, updateExpense } from '../expenses/expenses.service.js';
import { createSettlement } from '../settlements/settlements.service.js';
import { createIncome } from '../incomes/incomes.service.js';
import { createTransfer } from '../transfers/transfers.service.js';
import { createRecurringExpense } from '../recurring-expenses/recurring-expenses.service.js';
import { leaveHousehold, lockHousehold, lockHouseholdShared } from './households.service.js';

after(async () => {
  await prisma.$disconnect();
});

/**
 * Deterministic proof that the household lock serializes membership changes
 * against the writes that depend on them. A transaction plays the in-flight
 * leave (or write) and parks while holding its lock; the competing operation
 * must then stay blocked until that transaction commits, and judge the
 * committed state. If the lock were missing, the competitor would finish
 * immediately against stale data, which the "still pending" assertion catches.
 */

/** How long a blocked operation is given to (wrongly) finish before it counts as waiting. */
const GRACE_MS = 400;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

interface Outcome {
  value?: unknown;
  error?: unknown;
}

/** Starts `operation` and tracks its outcome without ever leaving a rejection unhandled. */
const track = (operation: () => Promise<unknown>) => {
  let outcome: Outcome | null = null;
  const done = operation().then(
    (value) => {
      outcome = { value };
      return outcome;
    },
    (error: unknown) => {
      outcome = { error };
      return outcome;
    },
  );
  return {
    isSettled: () => outcome !== null,
    result: () => done,
  };
};

/**
 * Runs `inside` in a transaction that takes `lock` first, signals it holds it,
 * and commits only after `release()`. Resolves once the lock is held.
 */
const holdLock = async (
  lock: typeof lockHousehold,
  householdId: string,
  inside: (tx: Parameters<typeof lockHousehold>[0]) => Promise<void>,
) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let acquired!: () => void;
  const locked = new Promise<void>((resolve) => {
    acquired = resolve;
  });
  const committed = prisma.$transaction(async (tx) => {
    await lock(tx, householdId);
    acquired();
    await gate;
    await inside(tx);
  });
  // A failing transaction would otherwise surface as an unhandled rejection
  // before the test awaits `commit()`.
  const settled = committed.then(
    () => null,
    (error: unknown) => ({ error }),
  );
  await locked;
  return {
    commit: async () => {
      release();
      const failure = await settled;
      if (failure) {
        throw failure.error;
      }
    },
  };
};

const setup = async () => {
  const admin = await registerTestUser(app);
  const householdId = await createTestHousehold(app, admin);
  const member = await addTestMember(app, admin, householdId);
  return { admin, member, householdId };
};

const markLeft =
  (householdId: string, userId: string) => async (tx: Parameters<typeof lockHousehold>[0]) => {
    await tx.householdMember.updateMany({
      where: { householdId, userId, leftAt: null },
      data: { leftAt: new Date() },
    });
  };

type Setup = Awaited<ReturnType<typeof setup>>;

/** Each write that checks membership, aimed at a household where `member` is about to leave. */
const writesInvolvingMember: {
  name: string;
  run: (s: Setup) => Promise<unknown>;
  count: (householdId: string) => Promise<number>;
}[] = [
  {
    name: 'an expense',
    run: ({ admin, member, householdId }) =>
      createExpense(admin.id, householdId, {
        description: 'Groceries',
        amount: '10.00',
        currencyCode: 'ARS',
        expenseDate: '2026-01-15',
        paidBy: member.id,
        splitType: 'equal',
        participants: [{ userId: admin.id }, { userId: member.id }],
      }),
    count: (householdId) => prisma.expense.count({ where: { householdId } }),
  },
  {
    name: 'a settlement',
    run: ({ admin, member, householdId }) =>
      createSettlement(admin.id, householdId, {
        fromUser: admin.id,
        toUser: member.id,
        amount: '10.00',
        currencyCode: 'ARS',
        settlementDate: '2026-01-15',
      }),
    count: (householdId) => prisma.settlement.count({ where: { householdId } }),
  },
  {
    name: 'a transfer',
    run: ({ admin, member, householdId }) =>
      createTransfer(admin.id, householdId, {
        fromUser: admin.id,
        toUser: member.id,
        amount: '10.00',
        currencyCode: 'ARS',
        transferDate: '2026-01-15',
      }),
    count: (householdId) => prisma.transfer.count({ where: { householdId } }),
  },
  {
    name: 'an income',
    run: ({ admin, member, householdId }) =>
      createIncome(admin.id, householdId, {
        receivedBy: member.id,
        description: 'Salary',
        amount: '10.00',
        currencyCode: 'ARS',
        incomeDate: '2026-01-15',
      }),
    count: (householdId) => prisma.income.count({ where: { householdId } }),
  },
  {
    name: 'a recurring template',
    run: ({ admin, member, householdId }) =>
      createRecurringExpense(admin.id, householdId, {
        description: 'Rent',
        defaultAmount: '10.00',
        currencyCode: 'ARS',
        paidBy: member.id,
        splitType: 'equal',
        participants: [{ userId: admin.id }, { userId: member.id }],
        frequency: 'monthly',
        startDate: '2026-01-01',
      }),
    count: (householdId) => prisma.recurringExpense.count({ where: { householdId } }),
  },
];

describe('household lock: writes wait for a leave in flight', () => {
  for (const write of writesInvolvingMember) {
    it(`blocks ${write.name} until the leave commits, then refuses the former member`, async () => {
      const s = await setup();
      const leave = await holdLock(
        lockHousehold,
        s.householdId,
        markLeft(s.householdId, s.member.id),
      );

      const pending = track(() => write.run(s));
      await sleep(GRACE_MS);
      assert.equal(pending.isSettled(), false, 'the write must wait for the lock holder');

      await leave.commit();
      const { error } = await pending.result();
      assert.ok(error instanceof AppError, `expected an AppError, got ${String(error)}`);
      assert.equal(error.statusCode, 422);
      assert.equal(await write.count(s.householdId), 0, 'nothing may be stored for the leaver');
    });
  }

  it('blocks confirming a pending occurrence until the leave commits, then keeps it pending', async () => {
    const s = await setup();
    const pendingExpense = await prisma.expense.create({
      data: {
        householdId: s.householdId,
        paidBy: s.member.id,
        createdBy: s.admin.id,
        description: 'Occurrence',
        amount: '10.00',
        currencyCode: 'ARS',
        splitType: 'equal',
        status: 'pending',
        expenseDate: new Date('2026-01-15'),
        splits: {
          createMany: {
            data: [
              { userId: s.admin.id, amount: '5.00' },
              { userId: s.member.id, amount: '5.00' },
            ],
          },
        },
      },
    });
    const leave = await holdLock(
      lockHousehold,
      s.householdId,
      markLeft(s.householdId, s.member.id),
    );

    const pending = track(() => confirmExpense(s.householdId, pendingExpense.id));
    await sleep(GRACE_MS);
    assert.equal(pending.isSettled(), false, 'the confirmation must wait for the lock holder');

    await leave.commit();
    const { error } = await pending.result();
    assert.ok(error instanceof AppError, `expected an AppError, got ${String(error)}`);
    assert.equal(error.statusCode, 409);
    const stored = await prisma.expense.findUniqueOrThrow({ where: { id: pendingExpense.id } });
    assert.equal(stored.status, 'pending');
  });

  it('blocks re-assigning an expense payer until the leave commits, then refuses the leaver', async () => {
    const s = await setup();
    const expense = await createExpense(s.admin.id, s.householdId, {
      description: 'Groceries',
      amount: '10.00',
      currencyCode: 'ARS',
      expenseDate: '2026-01-15',
      paidBy: s.admin.id,
      splitType: 'equal',
      participants: [{ userId: s.admin.id }],
    });
    const leave = await holdLock(
      lockHousehold,
      s.householdId,
      markLeft(s.householdId, s.member.id),
    );

    const pending = track(() => updateExpense(s.householdId, expense.id, { paidBy: s.member.id }));
    await sleep(GRACE_MS);
    assert.equal(pending.isSettled(), false, 'the edit must wait for the lock holder');

    await leave.commit();
    const { error } = await pending.result();
    assert.ok(error instanceof AppError, `expected an AppError, got ${String(error)}`);
    assert.equal(error.statusCode, 422);
    const stored = await prisma.expense.findUniqueOrThrow({ where: { id: expense.id } });
    assert.equal(stored.paidBy, s.admin.id);
  });

  it('blocks an expense until a currency change commits, then rejects the old currency', async () => {
    const s = await setup();
    const change = await holdLock(lockHousehold, s.householdId, async (tx) => {
      await tx.household.update({
        where: { id: s.householdId },
        data: { defaultCurrencyCode: 'USD' },
      });
    });

    const pending = track(() => writesInvolvingMember[0]!.run(s));
    await sleep(GRACE_MS);
    assert.equal(pending.isSettled(), false, 'the expense must wait for the currency change');

    await change.commit();
    const { error } = await pending.result();
    assert.ok(error instanceof AppError);
    assert.equal(error.code, ErrorCode.INVALID_CURRENCY);
    assert.equal(await prisma.expense.count({ where: { householdId: s.householdId } }), 0);
  });
});

describe('household lock: a leave waits for writes in flight', () => {
  const expenseWrittenBy = (s: Setup) => async (tx: Parameters<typeof lockHousehold>[0]) => {
    await tx.expense.create({
      data: {
        householdId: s.householdId,
        paidBy: s.member.id,
        createdBy: s.admin.id,
        description: 'In flight',
        amount: '10.00',
        currencyCode: 'ARS',
        splitType: 'equal',
        expenseDate: new Date('2026-01-15'),
        splits: {
          createMany: {
            data: [
              { userId: s.admin.id, amount: '5.00' },
              { userId: s.member.id, amount: '5.00' },
            ],
          },
        },
      },
    });
  };

  it('never lets the member leave with a balance created while the leave was waiting', async () => {
    const s = await setup();
    const write = await holdLock(lockHouseholdShared, s.householdId, expenseWrittenBy(s));

    const leaving = track(() => leaveHousehold(s.householdId, s.member.id));
    await sleep(GRACE_MS);
    assert.equal(leaving.isSettled(), false, 'the leave must wait for the write in flight');

    await write.commit();
    const { error } = await leaving.result();
    assert.ok(error instanceof AppError, `expected an AppError, got ${String(error)}`);
    assert.equal(error.code, ErrorCode.MEMBER_HAS_OPEN_BALANCE);

    const membership = await prisma.householdMember.findFirstOrThrow({
      where: { householdId: s.householdId, userId: s.member.id },
    });
    assert.equal(membership.leftAt, null, 'the member is still active');
  });

  it('lets writes run side by side: a share lock does not block another share lock', async () => {
    const s = await setup();
    const first = await holdLock(lockHouseholdShared, s.householdId, () => Promise.resolve());

    const second = track(() => writesInvolvingMember[0]!.run(s));
    const { error } = await second.result();
    assert.equal(error, undefined, 'a concurrent write must not wait for another write');

    await first.commit();
  });
});
