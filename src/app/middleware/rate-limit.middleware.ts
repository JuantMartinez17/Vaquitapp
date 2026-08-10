import rateLimit, { type Options } from 'express-rate-limit';
import { env } from '../config.js';
import { TooManyRequestsError } from '../../shared/errors/errors.js';

/**
 * IP-based limiter factory for `/auth/*` (register, login, refresh) — the
 * brute-force/credential-stuffing/spam-account surface. Exported as a
 * factory (not just the configured singleton below) so tests can mount a
 * low, deterministic limit without depending on env or a shared store.
 */
export const createAuthRateLimiter = (overrides?: Partial<Options>) =>
  rateLimit({
    windowMs: env.AUTH_RATE_LIMIT_WINDOW_MS,
    limit: env.AUTH_RATE_LIMIT_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, _res, next) => {
      next(new TooManyRequestsError('Too many attempts, please try again later'));
    },
    ...overrides,
  });

// A single in-memory store is enough since the app runs as one instance
// (see the ENABLE_SCHEDULER note in config.ts); a multi-instance deploy
// would need a shared store instead.
export const authRateLimiter = createAuthRateLimiter();
