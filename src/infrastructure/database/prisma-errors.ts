import { Prisma } from '../../generated/prisma/client.js';

export type DatabaseErrorKind = 'unique-violation' | 'not-found' | 'unavailable';

// Node/libuv socket errors. With the pg adapter an unreachable database does
// NOT surface as Prisma's P1001: it arrives as a PrismaClientKnownRequestError
// whose `code` is the raw socket code (e.g. "ECONNREFUSED").
const NETWORK_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'ETIMEDOUT',
  'EPIPE',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
]);

// Prisma's own connectivity codes: can't reach (P1001), timed out (P1002,
// P1008), connection closed (P1017), pool timeout (P2024).
const PRISMA_UNAVAILABLE_CODES = new Set(['P1001', 'P1002', 'P1008', 'P1017', 'P2024']);

// SQLSTATE classes/codes that mean "the database is not able to serve this
// right now": connection exceptions (08xxx), too many connections (53300),
// admin shutdown / crash recovery (57P01-57P03) and statement timeout (57014).
const isUnavailableSqlState = (sqlState: unknown): boolean =>
  typeof sqlState === 'string' &&
  (sqlState.startsWith('08') ||
    sqlState === '53300' ||
    sqlState === '57014' ||
    sqlState === '57P01' ||
    sqlState === '57P02' ||
    sqlState === '57P03');

// Errors thrown by `pg` itself pass through Prisma untouched as plain Errors
// (no `code`), so they can only be recognised by message: the pool ran out of
// connections, or the client-side query_timeout fired.
const PG_UNAVAILABLE_MESSAGES = [
  'timeout exceeded when trying to connect',
  'Query read timeout',
  'Connection terminated',
  'Client has encountered a connection error',
  'Connection terminated unexpectedly',
];

const sqlStateOf = (error: Prisma.PrismaClientKnownRequestError): unknown => {
  const driverError = error.meta?.driverAdapterError as { cause?: { originalCode?: unknown } };
  return driverError?.cause?.originalCode;
};

/**
 * Classifies a database-layer failure into the few kinds the HTTP layer
 * cares about, or `null` when the error is not a recognised database error.
 * Kept free of Express so it can be unit-tested with synthetic errors.
 */
export const classifyDatabaseError = (error: unknown): DatabaseErrorKind | null => {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      return 'unique-violation';
    }
    if (error.code === 'P2025') {
      return 'not-found';
    }
    if (
      PRISMA_UNAVAILABLE_CODES.has(error.code) ||
      NETWORK_ERROR_CODES.has(error.code) ||
      isUnavailableSqlState(sqlStateOf(error))
    ) {
      return 'unavailable';
    }
    return null;
  }

  if (error instanceof Prisma.PrismaClientInitializationError) {
    return 'unavailable';
  }

  if (error instanceof Error && PG_UNAVAILABLE_MESSAGES.some((m) => error.message.includes(m))) {
    return 'unavailable';
  }

  return null;
};
