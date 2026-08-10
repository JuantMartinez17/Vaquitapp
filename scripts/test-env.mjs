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

// registerTestUser (shared/testing/http.ts) alone makes dozens of real
// /auth/register calls per integration test file; the production default
// (20 per 15 min) would trip well before a file's fixtures finish setting
// up. The limiter's own enforcement is covered directly, with a low
// deterministic limit, in rate-limit.test.ts.
process.env.AUTH_RATE_LIMIT_MAX = '100000';
