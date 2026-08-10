// Loaded via `node --import` before tsx and the test files themselves.
//
// NODE_ENV=test: `app/config.ts` picks it up so Prisma logs only errors
// instead of every query (see infrastructure/database/prisma.ts).
//
// LOG_LEVEL=error: request-completed logs from pino-http are routine noise
// in a test run — assertions are on HTTP responses and DB state, not logs —
// but real errors should still surface.
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';
