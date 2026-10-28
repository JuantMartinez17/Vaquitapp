import { app } from './app/app.js';
import { env } from './app/config.js';
import { HTTP_REQUEST_TIMEOUT_MS } from './app/http-timeouts.js';
import { prisma } from './infrastructure/database/prisma.js';
import { logger } from './infrastructure/logging/logger.js';
import { startInterval, type SchedulerHandle } from './infrastructure/scheduler/scheduler.js';
import { runMaintenance } from './modules/maintenance/maintenance.service.js';
import { generateDueOccurrences } from './modules/recurring-expenses/recurring-expenses.service.js';

// A stray rejection (say, a best-effort cleanup that failed) should be loud
// and alertable but must not take the only instance down with it.
process.on('unhandledRejection', (reason: unknown) => {
  logger.fatal({ err: reason }, 'unhandled promise rejection');
});

// After an uncaught exception the process state is unknown: log it and exit
// so the platform restarts a clean instance.
process.on('uncaughtException', (err: Error) => {
  logger.fatal({ err }, 'uncaught exception, exiting');
  process.exit(1);
});

const server = app.listen(env.PORT, (error?: Error) => {
  if (error) {
    logger.fatal({ err: error, port: env.PORT }, 'failed to bind the HTTP port');
    process.exit(1);
  }
  logger.info({ port: env.PORT, environment: env.NODE_ENV }, 'Vaquitapp API listening');
});

// Aligned with the reverse proxy in front (Render's load balancer keeps idle
// connections for 60 s). The Node defaults (5 s keep-alive) would close
// sockets the proxy still considers open, surfacing as sporadic 502s. Node
// requires headersTimeout > keepAliveTimeout, and requestTimeout bounds a
// whole request (uploads included) so a stalled client cannot hold a socket
// forever.
server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;
server.requestTimeout = HTTP_REQUEST_TIMEOUT_MS;

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const SHUTDOWN_TIMEOUT_MS = 10_000;

// Background jobs must be enabled on exactly one instance (ENABLE_SCHEDULER),
// or a scaled-out deployment would double-generate occurrences and race the
// purges. Both run at boot and then daily; on Render Free the service sleeps
// when idle, so the boot run is what keeps them happening.
const schedulers: SchedulerHandle[] = [];

const scheduleJob = (name: string, job: () => Promise<void>): void => {
  schedulers.push(
    startInterval(job, ONE_DAY_MS, {
      onError: (err, { attempt, retryInMs }) =>
        logger.error({ err, job: name, attempt, retryInMs }, 'scheduled job run failed'),
      onSkipped: () =>
        logger.warn({ job: name }, 'scheduled job skipped: previous run still going'),
    }),
  );
};

if (env.ENABLE_SCHEDULER) {
  scheduleJob('recurring-expenses', async () => {
    const count = await generateDueOccurrences();
    logger.info({ count }, 'recurring expense generation run completed');
  });
  scheduleJob('maintenance', () => runMaintenance());
}

let isShuttingDown = false;

/**
 * Graceful shutdown: stop accepting connections, let in-flight requests and
 * the job that is running right now finish, then release the database pool.
 * The disconnect has to happen here because `process.exit()` never fires
 * `beforeExit`. A hard timeout bounds the whole thing, since the platform
 * will SIGKILL us shortly after SIGTERM anyway.
 */
const shutdown = async (signal: string): Promise<void> => {
  if (isShuttingDown) {
    logger.warn({ signal }, 'shutdown already in progress, ignoring signal');
    return;
  }
  isShuttingDown = true;
  logger.info({ signal }, 'shutting down');

  const forceExit = setTimeout(() => {
    logger.error({ timeoutMs: SHUTDOWN_TIMEOUT_MS }, 'graceful shutdown timed out, forcing exit');
    server.closeAllConnections();
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  const serverClosed = new Promise<void>((resolve) => server.close(() => resolve()));
  // Keep-alive sockets with no request in flight would otherwise hold
  // server.close() open until their idle timeout. A connection can also turn
  // idle later, once its in-flight request finishes, so sweep repeatedly.
  server.closeIdleConnections();
  const idleSweep = setInterval(() => server.closeIdleConnections(), 500);
  idleSweep.unref();
  void serverClosed.then(() => clearInterval(idleSweep));

  await Promise.all([serverClosed, ...schedulers.map((scheduler) => scheduler.stop())]);
  await prisma.$disconnect();
  logger.info('server closed');
  process.exit(0);
};

const runShutdown = (signal: string): void => {
  shutdown(signal).catch((err: unknown) => {
    logger.fatal({ err }, 'shutdown failed');
    process.exit(1);
  });
};

process.on('SIGTERM', () => runShutdown('SIGTERM'));
process.on('SIGINT', () => runShutdown('SIGINT'));
