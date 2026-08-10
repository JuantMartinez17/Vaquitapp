import { PrismaClient } from '../../generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { env } from '../../app/config.js';

const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });

export const prisma = new PrismaClient({
  adapter,
  log: env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
});

// Disconnecting is handled by the shutdown sequence in server.ts. A
// `beforeExit` listener would not help: it never fires on `process.exit()`.
