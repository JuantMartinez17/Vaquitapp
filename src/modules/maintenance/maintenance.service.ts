import { prisma } from '../../infrastructure/database/prisma.js';
import { logger } from '../../infrastructure/logging/logger.js';

const HOUR_MS = 60 * 60 * 1000;

// Matches the retention promised in idempotency.middleware.ts: long enough to
// cover any client retry, short enough that the table stays small.
export const IDEMPOTENCY_RETENTION_MS = 24 * HOUR_MS;

// Refresh tokens are kept this long after they expire or are revoked. A
// revoked row is what lets /auth/refresh recognise a replayed (stolen) token
// as TOKEN_REUSE_DETECTED; once purged, the same replay is just "invalid".
// A week past expiry or revocation is far beyond any realistic replay window.
export const REFRESH_TOKEN_GRACE_MS = 7 * 24 * HOUR_MS;

/**
 * Deletes idempotency keys older than 24 hours (by creation time).
 * @returns how many rows were removed.
 */
export const purgeIdempotencyKeys = async (now: Date = new Date()): Promise<number> => {
  const { count } = await prisma.idempotencyKey.deleteMany({
    where: { createdAt: { lt: new Date(now.getTime() - IDEMPOTENCY_RETENTION_MS) } },
  });
  return count;
};

/**
 * Deletes refresh tokens that expired, or were revoked, more than 7 days ago.
 * Live tokens and recently revoked ones (still useful for reuse detection)
 * are untouched.
 * @returns how many rows were removed.
 */
export const purgeStaleRefreshTokens = async (now: Date = new Date()): Promise<number> => {
  const cutoff = new Date(now.getTime() - REFRESH_TOKEN_GRACE_MS);
  const { count } = await prisma.refreshToken.deleteMany({
    where: { OR: [{ expiresAt: { lt: cutoff } }, { revokedAt: { lt: cutoff } }] },
  });
  return count;
};

/** One maintenance pass; the scheduler runs it at boot and then daily. */
export const runMaintenance = async (now: Date = new Date()): Promise<void> => {
  const idempotencyKeys = await purgeIdempotencyKeys(now);
  const refreshTokens = await purgeStaleRefreshTokens(now);
  logger.info({ idempotencyKeys, refreshTokens }, 'maintenance purge completed');
};
