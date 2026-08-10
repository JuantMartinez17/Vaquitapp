import { createHash } from 'node:crypto';
import type { RequestHandler } from 'express';
import { prisma } from '../../infrastructure/database/prisma.js';
import { logger } from '../../infrastructure/logging/logger.js';
import { asyncHandler } from '../../shared/utils/asyncHandler.js';
import { BadRequestError, ConflictError, UnauthorizedError } from '../../shared/errors/errors.js';
import { ErrorCode } from '../../shared/errors/codes.js';

/**
 * Requires `Idempotency-Key` on financial-mutation POSTs (D12): replaying
 * the same key with the same body returns the original response instead of
 * creating a duplicate; replaying it with a different body is a conflict.
 *
 * Must run AFTER `validate.middleware`, so the hash covers the
 * Zod-normalized body (stable key order, coerced types) rather than
 * whatever the client literally sent.
 *
 * The persist is awaited before the response is sent: a client that retries
 * the instant it sees a response must still find the row, or the dedup
 * guarantee this middleware exists for is void. A failed persist is logged
 * and swallowed rather than turned into a 500, since the underlying mutation
 * already succeeded — the tradeoff is a duplicate on that rare failure
 * instead of a false failure on every request.
 *
 * Retention: rows are kept 24h — long enough to cover client retries, short
 * enough that the table doesn't grow unbounded. Nothing prunes them yet;
 * add a scheduled `DELETE ... WHERE created_at < now() - interval '24 hours'`
 * once the scheduler carries more than one job.
 */
export const idempotent = (endpoint: string): RequestHandler =>
  asyncHandler(async (req, res, next) => {
    if (!req.user) {
      throw new UnauthorizedError();
    }
    const rawKey = req.headers['idempotency-key'];
    const key = Array.isArray(rawKey) ? rawKey[0] : rawKey;
    if (!key) {
      throw new BadRequestError('Idempotency-Key header is required');
    }

    const userId = req.user.id;
    const requestHash = createHash('sha256').update(JSON.stringify(req.body)).digest('hex');

    const existing = await prisma.idempotencyKey.findUnique({
      where: { key_userId: { key, userId } },
    });
    if (existing) {
      if (existing.endpoint !== endpoint || existing.requestHash !== requestHash) {
        throw new ConflictError(
          'This Idempotency-Key was already used with a different request',
          ErrorCode.IDEMPOTENCY_KEY_CONFLICT,
        );
      }
      res.status(existing.statusCode).json(JSON.parse(existing.responseBody) as unknown);
      return;
    }

    const originalJson = res.json.bind(res);
    res.json = (async (body: unknown) => {
      try {
        await prisma.idempotencyKey.create({
          data: {
            key,
            userId,
            endpoint,
            requestHash,
            statusCode: res.statusCode,
            responseBody: JSON.stringify(body),
          },
        });
      } catch (error) {
        logger.error({ error, key, endpoint }, 'failed to persist idempotency key');
      }
      return originalJson(body);
    }) as unknown as typeof res.json;

    next();
  });
