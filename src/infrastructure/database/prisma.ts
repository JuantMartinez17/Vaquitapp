import { PrismaClient } from '../../generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { env } from '../../app/config.js';
import { logger } from '../logging/logger.js';
import { buildPoolConfig } from './pool-config.js';

const adapter = new PrismaPg(buildPoolConfig(env), {
  // An idle connection dropped by Neon or a proxy emits 'error' on the pool;
  // without a listener that would be an uncaught exception. The pool simply
  // opens a fresh connection on next use, so a warning is all it deserves.
  onPoolError: (err) => logger.warn({ err }, 'idle database connection failed'),
});

export const prisma = new PrismaClient({
  adapter,
  log: env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
});

// Disconnecting is handled by the shutdown sequence in server.ts. A
// `beforeExit` listener would not help: it never fires on `process.exit()`.
