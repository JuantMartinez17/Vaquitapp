import { app } from './app/app.js';
import { env } from './app/config.js';
import { prisma } from './infrastructure/database/prisma.js';
import { logger } from './infrastructure/logging/logger.js';
import { startInterval } from './infrastructure/scheduler/scheduler.js';
import { generateDueOccurrences } from './modules/recurring-expenses/recurring-expenses.service.js';

const server = app.listen(env.PORT, () => {
  console.log(`🚀 Vaquitapp API listening on http://localhost:${env.PORT}`);
  console.log(`   Environment: ${env.NODE_ENV}`);
});

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// Recurring-expense generation — must be enabled on exactly one instance
// (ENABLE_SCHEDULER), or a scaled-out deployment would double-generate.
const schedulerHandle = env.ENABLE_SCHEDULER
  ? startInterval(
      async () => {
        const count = await generateDueOccurrences();
        logger.info({ count }, 'recurring expense generation run completed');
      },
      ONE_DAY_MS,
      (error: unknown) => logger.error({ error }, 'recurring expense generation run failed'),
    )
  : null;

/**
 * Graceful shutdown: stop accepting connections, then release the database
 * pool. The disconnect has to happen here because `process.exit()` never
 * fires `beforeExit`.
 */
const shutdown = async (signal: string): Promise<void> => {
  console.log(`\n${signal} received, shutting down...`);
  if (schedulerHandle) {
    clearInterval(schedulerHandle);
  }
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await prisma.$disconnect();
  console.log('Server closed.');
  process.exit(0);
};

const runShutdown = (signal: string): void => {
  shutdown(signal).catch((error: unknown) => {
    console.error('Shutdown failed:', error);
    process.exit(1);
  });
};

process.on('SIGTERM', () => runShutdown('SIGTERM'));
process.on('SIGINT', () => runShutdown('SIGINT'));
