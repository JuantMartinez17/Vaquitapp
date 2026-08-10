import { app } from './app.js';
import { env } from './config/env.js';
import { prisma } from './config/prisma.js';

const server = app.listen(env.PORT, () => {
  console.log(`🚀 Vaquitapp API listening on http://localhost:${env.PORT}`);
  console.log(`   Environment: ${env.NODE_ENV}`);
});

/**
 * Graceful shutdown: stop accepting connections, then release the database
 * pool. The disconnect has to happen here because `process.exit()` never
 * fires `beforeExit`.
 */
const shutdown = async (signal: string): Promise<void> => {
  console.log(`\n${signal} received, shutting down...`);
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
