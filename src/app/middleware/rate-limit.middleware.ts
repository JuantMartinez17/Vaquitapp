import rateLimit, { type Options } from 'express-rate-limit';
import { env } from '../config.js';
import { TooManyRequestsError } from '../../shared/errors/errors.js';

/**
 * IP-based limiter factory. Exported (not just the configured singletons
 * below) so tests can mount a low, deterministic limit without depending on
 * env or a shared store.
 */
export const createRateLimiter = (
  options: Partial<Options> & Pick<Options, 'limit' | 'windowMs'>,
) =>
  rateLimit({
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, _res, next) => {
      next(new TooManyRequestsError('Too many attempts, please try again later'));
    },
    ...options,
  });

// Every limiter below has its own in-memory store, so one endpoint's budget
// never drains another's. A single in-memory store per limiter is enough
// since the app runs as one instance (see the ENABLE_SCHEDULER note in
// config.ts); a multi-instance deploy would need a shared store instead.

/**
 * Login counts failed attempts only: the brute-force/credential-stuffing
 * surface is wrong passwords, and a user who logs in successfully should not
 * burn budget that an attacker behind the same NAT then inherits.
 */
export const loginRateLimiter = createRateLimiter({
  windowMs: env.AUTH_RATE_LIMIT_WINDOW_MS,
  limit: env.AUTH_RATE_LIMIT_MAX,
  skipSuccessfulRequests: true,
});

/** Account creation is the spam surface, so every attempt counts. */
export const registerRateLimiter = createRateLimiter({
  windowMs: env.AUTH_RATE_LIMIT_WINDOW_MS,
  limit: env.AUTH_REGISTER_RATE_LIMIT_MAX,
});

/**
 * Refresh has its own, higher budget: every signed-in client calls it about
 * every 15 minutes, and several users can share one IP.
 */
export const refreshRateLimiter = createRateLimiter({
  windowMs: env.AUTH_RATE_LIMIT_WINDOW_MS,
  limit: env.AUTH_REFRESH_RATE_LIMIT_MAX,
});

/** Light per-IP ceiling on the whole API, a backstop against runaway clients. */
export const apiRateLimiter = createRateLimiter({
  windowMs: env.API_RATE_LIMIT_WINDOW_MS,
  limit: env.API_RATE_LIMIT_MAX,
});
