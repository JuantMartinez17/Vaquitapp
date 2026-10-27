import { randomUUID } from 'node:crypto';
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { app } from '../../app/app.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { registerTestUser } from '../../shared/testing/http.js';
import {
  purgeIdempotencyKeys,
  purgeStaleRefreshTokens,
  runMaintenance,
} from './maintenance.service.js';

after(async () => {
  await prisma.$disconnect();
});

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const NOW = new Date();
const ago = (ms: number): Date => new Date(NOW.getTime() - ms);

const existingIds = async (table: 'idempotencyKey' | 'refreshToken', ids: string[]) => {
  const rows =
    table === 'idempotencyKey'
      ? await prisma.idempotencyKey.findMany({ where: { id: { in: ids } }, select: { id: true } })
      : await prisma.refreshToken.findMany({ where: { id: { in: ids } }, select: { id: true } });
  return new Set(rows.map((row) => row.id));
};

describe('purgeIdempotencyKeys', () => {
  it('deletes keys older than 24 hours and keeps newer ones', async () => {
    const user = await registerTestUser(app);
    const make = (createdAt: Date) => ({
      id: randomUUID(),
      key: randomUUID(),
      userId: user.id,
      endpoint: 'POST /test',
      requestHash: 'h',
      statusCode: 201,
      responseBody: '{}',
      createdAt,
    });
    const stale = make(ago(25 * HOUR_MS));
    const fresh = make(ago(23 * HOUR_MS));
    await prisma.idempotencyKey.createMany({ data: [stale, fresh] });

    const removed = await purgeIdempotencyKeys(NOW);

    assert.ok(removed >= 1);
    const remaining = await existingIds('idempotencyKey', [stale.id, fresh.id]);
    assert.equal(remaining.has(stale.id), false, 'the 25 h old key is purged');
    assert.equal(remaining.has(fresh.id), true, 'the 23 h old key is kept');
  });
});

describe('purgeStaleRefreshTokens', () => {
  it('deletes tokens expired or revoked over 7 days ago, keeping live and recent ones', async () => {
    const user = await registerTestUser(app);
    const make = (overrides: { expiresAt: Date; revokedAt?: Date }) => ({
      id: randomUUID(),
      userId: user.id,
      tokenHash: randomUUID(),
      ...overrides,
    });
    const expiredLongAgo = make({ expiresAt: ago(8 * DAY_MS) });
    const revokedLongAgo = make({
      expiresAt: new Date(NOW.getTime() + 20 * DAY_MS),
      revokedAt: ago(8 * DAY_MS),
    });
    const expiredRecently = make({ expiresAt: ago(6 * DAY_MS) });
    const revokedRecently = make({
      expiresAt: new Date(NOW.getTime() + 20 * DAY_MS),
      revokedAt: ago(2 * DAY_MS),
    });
    const live = make({ expiresAt: new Date(NOW.getTime() + 20 * DAY_MS) });
    const all = [expiredLongAgo, revokedLongAgo, expiredRecently, revokedRecently, live];
    await prisma.refreshToken.createMany({ data: all });

    const removed = await purgeStaleRefreshTokens(NOW);

    assert.ok(removed >= 2);
    const remaining = await existingIds(
      'refreshToken',
      all.map((token) => token.id),
    );
    assert.equal(remaining.has(expiredLongAgo.id), false);
    assert.equal(remaining.has(revokedLongAgo.id), false);
    assert.equal(remaining.has(expiredRecently.id), true);
    assert.equal(remaining.has(revokedRecently.id), true, 'kept for token reuse detection');
    assert.equal(remaining.has(live.id), true);
  });
});

describe('runMaintenance', () => {
  it('runs both purges without error', async () => {
    await runMaintenance(NOW);
  });
});
