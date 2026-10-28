/**
 * Shared helpers for the benchmark harness (seed.ts / run.ts).
 *
 * Nothing here prints secrets: the bench database URL is derived from the
 * repo's `.env` (or BENCH_DATABASE_URL) and only ever passed to child
 * processes through their environment / an env-file.
 */
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BENCH_DIR = dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = join(BENCH_DIR, '..', '..');
export const STATE_FILE = join(BENCH_DIR, '.state.json');
export const RESULTS_DIR = join(BENCH_DIR, 'results');

export const BENCH_DB_NAME = 'vaquitapp_bench';
export const BENCH_PASSWORD = 'BenchPass123!';

/**
 * Throwaway values, only meaningful for this benchmark. Fixed (instead of
 * read from .env) so the seeding server and every container under test sign
 * and verify tokens with the same keys, whatever the image's age.
 */
export const BENCH_APP_ENV: Record<string, string> = {
  NODE_ENV: 'production',
  JWT_ACCESS_SECRET: 'bench-access-secret-0123456789abcdef0123456789',
  JWT_REFRESH_SECRET: 'bench-refresh-secret-0123456789abcdef012345678',
  JWT_ACCESS_TTL: '4h',
  JWT_REFRESH_TTL: '30d',
  CORS_ORIGINS: 'http://localhost:5173',
  STORAGE_PROVIDER: 'local',
  LOCAL_STORAGE_SECRET: 'bench-local-storage-secret-0123456789abcdef',
  LOCAL_STORAGE_DIR: './uploads',
  ENABLE_SCHEDULER: 'false',
  // /auth/login is benchmarked 30+ times from one IP; the production default
  // (20 per 15 min) would turn the measurement into a stream of 429s.
  AUTH_RATE_LIMIT_MAX: '1000000',
};

/**
 * The bench database URL: BENCH_DATABASE_URL if set, otherwise DATABASE_URL
 * from .env with the database name swapped for `vaquitapp_bench`.
 */
export const benchDatabaseUrl = (): URL => {
  const raw = process.env.BENCH_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!raw) {
    throw new Error('Set BENCH_DATABASE_URL (or DATABASE_URL in .env) to reach the server.');
  }
  const url = new URL(raw);
  if (!process.env.BENCH_DATABASE_URL) {
    url.pathname = `/${BENCH_DB_NAME}`;
  }
  assertBenchDb(url);
  return url;
};

/** Safety net: this harness resets/fills its database, never a real one. */
export const assertBenchDb = (url: URL): void => {
  const name = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!name.includes('bench')) {
    throw new Error(`Refusing to touch database "${name}": its name must contain "bench".`);
  }
};

// ── Deterministic PRNG (mulberry32) ─────────────────────────────────────────
export const makeRng = (seed: number) => {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min: number, max: number): number => min + Math.floor(next() * (max - min + 1)),
    pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)]!,
    chance: (p: number): boolean => next() < p,
  };
};
export type Rng = ReturnType<typeof makeRng>;

// ── State file ──────────────────────────────────────────────────────────────
export interface BenchUser {
  id: string;
  email: string;
  username: string;
  password: string;
}
export interface HouseholdState {
  id: string;
  name: string;
  memberIds: string[];
  expenses: number;
  settlements: number;
  incomes: number;
}
export interface BenchState {
  createdAt: string;
  seed: number;
  users: BenchUser[];
  bigHousehold: HouseholdState;
  smallHouseholds: HouseholdState[];
  /** User that logs in during the run; admin + payer in the big household. */
  loginUser: BenchUser;
  /** "1 year" analytics window, pinned at seed time so every run asks the same thing. */
  analyticsRange: { from: string; to: string };
}

export const readState = (): BenchState => {
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf8')) as BenchState;
  } catch {
    throw new Error(
      'scripts/bench/.state.json not found: run `npx tsx scripts/bench/seed.ts` first.',
    );
  }
};

// ── HTTP ────────────────────────────────────────────────────────────────────
export interface ApiResult {
  status: number;
  body: unknown;
}

export const api = async (
  base: string,
  method: string,
  path: string,
  opts: { token?: string; body?: unknown; idempotent?: boolean; timeoutMs?: number } = {},
): Promise<ApiResult> => {
  const headers: Record<string, string> = {};
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.idempotent) headers['Idempotency-Key'] = randomUUID();
  const res = await fetch(base + path, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000),
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? (JSON.parse(text) as unknown) : null;
  } catch {
    /* non-JSON body: keep the raw text */
  }
  return { status: res.status, body };
};

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export const pad2 = (n: number): string => String(n).padStart(2, '0');
export const civilDate = (d: Date): string =>
  `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
