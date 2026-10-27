import { Router } from 'express';
import { prisma } from '../database/prisma.js';
import { logger } from '../logging/logger.js';
import { asyncHandler } from '../../shared/utils/asyncHandler.js';

const READINESS_TIMEOUT_MS = 2_000;

interface HealthRouterOptions {
  /** Resolves when the database answers; rejects (or hangs) when it does not. */
  probe?: () => Promise<unknown>;
  timeoutMs?: number;
}

/**
 * - `/health`: liveness only. Touches nothing, so it is the one safe target
 *   for a platform health check: a database blip must not restart the
 *   service, and pinging Postgres on a schedule would keep a serverless
 *   database awake for nothing.
 * - `/health/ready`: readiness. Pings the database with a hard timeout, so a
 *   stalled connection yields a fast 503 instead of a hanging request.
 */
export const createHealthRouter = ({
  probe = () => prisma.$queryRaw`SELECT 1`,
  timeoutMs = READINESS_TIMEOUT_MS,
}: HealthRouterOptions = {}): Router => {
  const router = Router();

  router.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  router.get(
    '/health/ready',
    asyncHandler(async (_req, res) => {
      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Database ping exceeded ${timeoutMs} ms`)),
          timeoutMs,
        );
      });
      try {
        await Promise.race([probe(), timeout]);
        res.json({ status: 'ready', database: 'connected' });
      } catch (err) {
        logger.warn({ err }, 'readiness check failed');
        res.status(503).json({ status: 'not ready', database: 'disconnected' });
      } finally {
        clearTimeout(timer);
      }
    }),
  );

  return router;
};
