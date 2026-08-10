import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Decimal } from 'decimal.js';
import { calculateBalances, simplifyDebts } from './balance.js';
import type { ExpenseActivity, SettlementActivity } from './balance.js';
import { sumDecimals } from '../money/money.js';

const netSum = (balances: { net: Decimal }[]): string =>
  sumDecimals(balances.map((b) => b.net)).toFixed(2);

describe('calculateBalances', () => {
  it('reproduces the SPECS.md §7 worked example', () => {
    // Juan pays a $100 supermarket run split evenly with Maria.
    const expenses: ExpenseActivity[] = [
      {
        paidBy: 'juan',
        amount: 100,
        splits: [
          { userId: 'juan', amount: 50 },
          { userId: 'maria', amount: 50 },
        ],
      },
      // Maria pays a $40 electricity bill split evenly.
      {
        paidBy: 'maria',
        amount: 40,
        splits: [
          { userId: 'juan', amount: 20 },
          { userId: 'maria', amount: 20 },
        ],
      },
    ];

    const balances = calculateBalances(expenses, []);
    const juan = balances.find((b) => b.userId === 'juan')!;
    const maria = balances.find((b) => b.userId === 'maria')!;
    assert.equal(juan.net.toFixed(2), '30.00');
    assert.equal(maria.net.toFixed(2), '-30.00');
    assert.equal(netSum(balances), '0.00');

    const simplified = simplifyDebts(balances);
    assert.equal(simplified.length, 1);
    assert.equal(simplified[0]!.from, 'maria');
    assert.equal(simplified[0]!.to, 'juan');
    assert.equal(simplified[0]!.amount.toFixed(2), '30.00');
  });

  it('a settlement for the exact simplified amount zeroes both members', () => {
    const expenses: ExpenseActivity[] = [
      {
        paidBy: 'juan',
        amount: 100,
        splits: [
          { userId: 'juan', amount: 50 },
          { userId: 'maria', amount: 50 },
        ],
      },
    ];
    const settlements: SettlementActivity[] = [{ fromUser: 'maria', toUser: 'juan', amount: 50 }];

    const balances = calculateBalances(expenses, settlements);
    assert.equal(balances.find((b) => b.userId === 'juan')!.net.toFixed(2), '0.00');
    assert.equal(balances.find((b) => b.userId === 'maria')!.net.toFixed(2), '0.00');
  });

  it('a partial settlement reduces but does not zero the balance', () => {
    const expenses: ExpenseActivity[] = [
      {
        paidBy: 'a',
        amount: 100,
        splits: [
          { userId: 'a', amount: 50 },
          { userId: 'b', amount: 50 },
        ],
      },
    ];
    const settlements: SettlementActivity[] = [{ fromUser: 'b', toUser: 'a', amount: 20 }];

    const balances = calculateBalances(expenses, settlements);
    assert.equal(balances.find((b) => b.userId === 'a')!.net.toFixed(2), '30.00');
    assert.equal(balances.find((b) => b.userId === 'b')!.net.toFixed(2), '-30.00');
  });

  it('a single participant at 100% (personal expense) nets to zero for everyone', () => {
    const expenses: ExpenseActivity[] = [
      { paidBy: 'a', amount: 100, splits: [{ userId: 'a', amount: 100 }] },
    ];
    const balances = calculateBalances(expenses, []);
    assert.equal(balances.length, 1);
    assert.equal(balances[0]!.net.toFixed(2), '0.00');
  });

  it('keeps Σ(balances) == 0 across randomized activity', () => {
    const users = ['a', 'b', 'c', 'd'];
    const expenses: ExpenseActivity[] = [];
    let seed = 42;
    const rand = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };

    for (let i = 0; i < 30; i++) {
      const payer = users[Math.floor(rand() * users.length)]!;
      const amount = new Decimal(Math.floor(rand() * 10000) + 1).dividedBy(100);
      const participants = users.filter(() => rand() > 0.3);
      if (participants.length === 0) participants.push(payer);
      const share = amount.dividedBy(participants.length).toDecimalPlaces(2, Decimal.ROUND_DOWN);
      const splits = participants.map((userId, idx) => ({
        userId,
        // dump the rounding remainder on the first participant to keep this
        // fixture internally consistent; the real allocate() invariant is
        // covered separately in domain/splitting.
        amount: idx === 0 ? amount.minus(share.times(participants.length - 1)) : share,
      }));
      expenses.push({ paidBy: payer, amount, splits });
    }

    const balances = calculateBalances(expenses, []);
    assert.equal(netSum(balances), '0.00');

    const simplified = simplifyDebts(balances);
    const resultingBalances = calculateBalances(
      expenses,
      simplified.map((t) => ({ fromUser: t.from, toUser: t.to, amount: t.amount })),
    );
    for (const balance of resultingBalances) {
      assert.equal(balance.net.toFixed(2), '0.00');
    }
  });
});

describe('simplifyDebts', () => {
  it('nets three-way reciprocal debts into the minimal transfer set', () => {
    // a owes b 10, b owes c 10 -> nets to a owes c 10, nobody owes b.
    const balances = calculateBalances(
      [
        { paidBy: 'b', amount: 10, splits: [{ userId: 'a', amount: 10 }] },
        { paidBy: 'c', amount: 10, splits: [{ userId: 'b', amount: 10 }] },
      ],
      [],
    );
    const simplified = simplifyDebts(balances);
    assert.equal(simplified.length, 1);
    assert.deepEqual(
      {
        from: simplified[0]!.from,
        to: simplified[0]!.to,
        amount: simplified[0]!.amount.toFixed(2),
      },
      { from: 'a', to: 'c', amount: '10.00' },
    );
  });

  it('produces no transfers when everyone is already at zero', () => {
    assert.deepEqual(simplifyDebts([]), []);
  });
});
