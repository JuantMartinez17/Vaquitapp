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
// /auth/register calls per integration test file, and a whole file's
// requests all come from one IP; the production defaults would trip well
// before the fixtures finish setting up. Enforcement of each limiter is
// covered with low, deterministic limits in rate-limit.test.ts and
// rate-limit.itest.ts (which overrides these before importing the app).
process.env.AUTH_RATE_LIMIT_MAX = '100000';
process.env.AUTH_REGISTER_RATE_LIMIT_MAX = '100000';
process.env.AUTH_REFRESH_RATE_LIMIT_MAX = '100000';
process.env.API_RATE_LIMIT_MAX = '100000';
