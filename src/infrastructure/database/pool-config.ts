/** The subset of node-postgres' PoolConfig that this app sets (structurally compatible). */
export interface PoolConfig {
  connectionString: string;
  max: number;
  idleTimeoutMillis: number;
  connectionTimeoutMillis: number;
  query_timeout: number;
  keepAlive: boolean;
  statement_timeout?: number;
}

export interface PoolSettings {
  DATABASE_URL: string;
  DB_POOL_MAX: number;
  /** Opt-in server-side statement timeout; see the note in `buildPoolConfig`. */
  DB_STATEMENT_TIMEOUT_MS?: number | undefined;
}

// Idle connections are dropped well before a serverless Postgres or a proxy
// would silently kill them, so the pool rarely hands out a dead socket.
const IDLE_TIMEOUT_MS = 30_000;
// Long enough to ride out a Neon cold start, short enough that a stalled
// pool fails the request instead of hanging it.
const CONNECTION_TIMEOUT_MS = 10_000;
// Client-side guard: pg abandons the wait for a reply after this long. It
// bounds how long a request can sit on a query without asking the server
// for anything, which is why it is safe behind pgbouncer.
const QUERY_TIMEOUT_MS = 20_000;

/**
 * Pool options for the `pg` driver behind Prisma's adapter.
 *
 * `statement_timeout` is deliberately absent unless DB_STATEMENT_TIMEOUT_MS
 * is set: node-postgres sends it as a startup parameter, and Neon's pooled
 * (pgbouncer) endpoint rejects startup parameters it does not recognise,
 * which would make every connection fail. Opt in only on a direct URL.
 */
export const buildPoolConfig = (settings: PoolSettings): PoolConfig => ({
  connectionString: settings.DATABASE_URL,
  max: settings.DB_POOL_MAX,
  idleTimeoutMillis: IDLE_TIMEOUT_MS,
  connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
  query_timeout: QUERY_TIMEOUT_MS,
  keepAlive: true,
  ...(settings.DB_STATEMENT_TIMEOUT_MS !== undefined
    ? { statement_timeout: settings.DB_STATEMENT_TIMEOUT_MS }
    : {}),
});
