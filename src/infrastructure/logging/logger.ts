import pino from 'pino';
import { env } from '../../app/config.js';

/**
 * Base logger instance. `app.ts` hands this to pino-http for request logs;
 * anything running outside a request (the scheduler, startup/shutdown) logs
 * through this directly since there's no `req.log` to use.
 */
export const logger = pino({ level: env.LOG_LEVEL });
