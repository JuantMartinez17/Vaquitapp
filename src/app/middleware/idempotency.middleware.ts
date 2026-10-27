import { createHash, randomUUID } from 'node:crypto';
import type { Request, RequestHandler, Response } from 'express';
import { prisma } from '../../infrastructure/database/prisma.js';
import { logger } from '../../infrastructure/logging/logger.js';
import { asyncHandler } from '../../shared/utils/asyncHandler.js';
import { routeParam } from '../../shared/utils/request.js';
import { BadRequestError, ConflictError, UnauthorizedError } from '../../shared/errors/errors.js';
import { ErrorCode } from '../../shared/errors/codes.js';
import { HTTP_REQUEST_TIMEOUT_MS } from '../http-timeouts.js';

/** Retention of a stored response; an older row is treated as if it did not exist. */
const KEY_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * `statusCode` of a claim whose handler has not answered yet. The table has no
 * status column, and 0 can never be a real HTTP status, so it doubles as the
 * "in progress" marker without a schema change.
 */
const IN_PROGRESS = 0;

/**
 * An in-progress claim older than this is assumed to belong to a request that
 * died with its process (a restart on a small instance); a retry may take it
 * over. It must outlast the HTTP server's request timeout, or a slow but
 * still-running handler could be executed a second time by its own retry; the
 * margin covers the time between the claim and the handler finishing.
 */
const STALE_CLAIM_MS = HTTP_REQUEST_TIMEOUT_MS + 10_000;

const RETRY_AFTER_SECONDS = 2;
const MAX_CLAIM_ATTEMPTS = 3;

const KEY_FORMAT = /^[\x20-\x7e]{1,255}$/;

type Claim = { kind: 'claimed'; id: string } | { kind: 'replay'; statusCode: number; body: string };

const readKey = (req: Request): string => {
  const raw = req.headers['idempotency-key'];
  const key = Array.isArray(raw) ? raw[0] : raw;
  if (!key) {
    throw new BadRequestError('Idempotency-Key header is required');
  }
  if (!KEY_FORMAT.test(key)) {
    throw new BadRequestError('Idempotency-Key must be 1 to 255 printable ASCII characters');
  }
  return key;
};

const isSuccess = (statusCode: number): boolean => statusCode >= 200 && statusCode < 300;

/**
 * Claims `(key, userId)` by inserting its row BEFORE the handler runs; the
 * unique constraint arbitrates between concurrent requests, so exactly one
 * runs the handler. Anything else is classified from the row that is already
 * there: replay it, reject it, or (if it is expired, abandoned or a leftover
 * error) clear it and claim again.
 */
const claimKey = async (
  res: Response,
  params: { key: string; userId: string; scope: string; requestHash: string },
): Promise<Claim> => {
  const { key, userId, scope, requestHash } = params;

  for (let attempt = 0; attempt < MAX_CLAIM_ATTEMPTS; attempt += 1) {
    // `skipDuplicates` is INSERT ... ON CONFLICT DO NOTHING: losing the race is
    // a count of 0 instead of an exception that Prisma would log as an error
    // on every legitimate retry.
    const id = randomUUID();
    const inserted = await prisma.idempotencyKey.createMany({
      data: [
        {
          id,
          key,
          userId,
          endpoint: scope,
          requestHash,
          statusCode: IN_PROGRESS,
          responseBody: '',
        },
      ],
      skipDuplicates: true,
    });
    if (inserted.count === 1) {
      return { kind: 'claimed', id };
    }

    const existing = await prisma.idempotencyKey.findUnique({
      where: { key_userId: { key, userId } },
    });
    if (!existing) {
      continue; // released in between: claim again
    }

    const ageMs = Date.now() - existing.createdAt.getTime();
    if (ageMs > KEY_TTL_MS) {
      await prisma.idempotencyKey.deleteMany({ where: { id: existing.id } });
      continue;
    }

    if (existing.endpoint !== scope || existing.requestHash !== requestHash) {
      throw new ConflictError(
        'This Idempotency-Key was already used with a different request',
        ErrorCode.IDEMPOTENCY_KEY_CONFLICT,
      );
    }

    if (isSuccess(existing.statusCode)) {
      return { kind: 'replay', statusCode: existing.statusCode, body: existing.responseBody };
    }

    if (existing.statusCode === IN_PROGRESS && ageMs <= STALE_CLAIM_MS) {
      res.setHeader('Retry-After', String(RETRY_AFTER_SECONDS));
      throw new ConflictError(
        'A request with this Idempotency-Key is still being processed',
        ErrorCode.IDEMPOTENCY_KEY_IN_PROGRESS,
      );
    }

    // Abandoned claim, or an error response stored by an older version of this
    // middleware: only successes may be replayed, so clear it and run again.
    // Guarded by the status so a claim that completed meanwhile survives.
    await prisma.idempotencyKey.deleteMany({
      where: { id: existing.id, statusCode: existing.statusCode },
    });
  }

  res.setHeader('Retry-After', String(RETRY_AFTER_SECONDS));
  throw new ConflictError(
    'Could not claim this Idempotency-Key, retry shortly',
    ErrorCode.IDEMPOTENCY_KEY_IN_PROGRESS,
  );
};

/**
 * Makes a financial-mutation POST safe to retry (D12): the client sends an
 * `Idempotency-Key`, and re-sending the same key with the same body returns the
 * original response instead of creating a duplicate.
 *
 * - The key is claimed before the handler runs, so two concurrent requests
 *   with one key cannot both execute. The loser gets 409
 *   `IDEMPOTENCY_KEY_IN_PROGRESS` with `Retry-After`.
 * - Only 2xx responses are stored and replayed. On any other outcome the claim
 *   is deleted so the client can retry the request for real.
 * - The same key with a different body, endpoint or household is 409
 *   `IDEMPOTENCY_KEY_CONFLICT`. The household is part of the scope because the
 *   same body means something different in another household.
 * - A stored response expires after 24h, enforced on read (the row is replaced);
 *   rows that are never read again are purged by the maintenance job.
 *
 * Must run AFTER `validate.middleware`, so the hash covers the Zod-normalized
 * body (stable key order, coerced types) rather than whatever the client sent.
 * The handler must answer with `res.json`, which is where the outcome is
 * recorded; the record is awaited before the response is sent so a client that
 * retries the instant it sees a response always finds it.
 */
export const idempotent = (endpoint: string): RequestHandler =>
  asyncHandler(async (req, res, next) => {
    if (!req.user) {
      throw new UnauthorizedError();
    }
    const key = readKey(req);

    const householdId = routeParam(req, 'householdId');
    const scope = householdId ? `${endpoint} @${householdId}` : endpoint;
    const requestHash = createHash('sha256').update(JSON.stringify(req.body)).digest('hex');

    const claim = await claimKey(res, { key, userId: req.user.id, scope, requestHash });
    if (claim.kind === 'replay') {
      res.setHeader('Idempotency-Replayed', 'true');
      res.status(claim.statusCode).json(JSON.parse(claim.body) as unknown);
      return;
    }

    const claimId = claim.id;
    const originalJson = res.json.bind(res);
    let recorded = false;
    // `errorMiddleware` answers through the same `res.json`, so this one hook
    // sees every outcome: success is stored, anything else releases the claim.
    res.json = ((body: unknown) => {
      if (recorded) {
        return originalJson(body);
      }
      recorded = true;
      const statusCode = res.statusCode;
      const settle = isSuccess(statusCode)
        ? prisma.idempotencyKey.updateMany({
            where: { id: claimId, statusCode: IN_PROGRESS },
            data: { statusCode, responseBody: JSON.stringify(body ?? null) },
          })
        : prisma.idempotencyKey.deleteMany({ where: { id: claimId, statusCode: IN_PROGRESS } });
      // A failed record is logged, not turned into a 500: the mutation already
      // happened, and the claim then expires as abandoned.
      return settle
        .catch((error: unknown) => {
          logger.error(
            { err: error, key, endpoint: scope, statusCode },
            'failed to settle idempotency key',
          );
        })
        .then(() => originalJson(body));
    }) as unknown as typeof res.json;

    next();
  });
