import pino from 'pino';
import { env } from '../../app/config.js';

/**
 * Field paths that must never reach a log line, even if someone logs a whole
 * request, a DTO or a database row by mistake. The one-level wildcards cover
 * credentials nested inside a logged object (`{ body: { password } }`).
 */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  'headers.authorization',
  'headers.cookie',
  'authorization',
  'password',
  'passwordHash',
  'token',
  'accessToken',
  'refreshToken',
  '*.password',
  '*.passwordHash',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.authorization',
  '*.cookie',
];

/**
 * Base logger instance. `app.ts` hands this to pino-http for request logs;
 * anything running outside a request (the scheduler, startup/shutdown) logs
 * through this directly since there's no `req.log` to use.
 *
 * It deliberately writes synchronously to stdout (no async destination): on
 * a crash or a SIGTERM the last lines — usually the ones that explain it —
 * must already be out. Errors must be logged under the `err` key, the only
 * one pino's serializer unpacks; `{ error }` would serialize as `{}`.
 */
export const logger = pino({
  level: env.LOG_LEVEL,
  redact: { paths: REDACT_PATHS, censor: '[Redacted]' },
});
