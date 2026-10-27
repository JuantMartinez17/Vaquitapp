/**
 * Seeds the benchmark database with a realistic, deterministic dataset.
 *
 *   npx tsx scripts/bench/seed.ts            # migrate + reference data + dataset
 *   npx tsx scripts/bench/seed.ts --reset    # wipe the bench DB first (re-seed)
 *
 * Steps:
 *   1. `prisma migrate deploy` + the regular `prisma/seed.ts` (currencies,
 *      system categories) against the bench database.
 *   2. Boots THIS worktree's server locally (`node --import tsx src/server.ts`,
 *      much faster than seeding through a 0.1-CPU container).
 *   3. Creates everything through the public HTTP API, so the same script
 *      works across schema versions: 8 users, one "big" household
 *      (5 members, ~3,000 expenses over 3 years with all four split types,
 *      ~150 settlements, ~300 incomes) and three small households.
 *   4. Writes ids/credentials to scripts/bench/.state.json (gitignored).
 *
 * All randomness comes from a fixed-seed PRNG, so the same code produces the
 * same dataset (apart from server-generated ids and "today" as the end date).
 */
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import pg from 'pg';
import {
  BENCH_APP_ENV,
  BENCH_PASSWORD,
  ROOT_DIR,
  STATE_FILE,
  api,
  assertBenchDb,
  benchDatabaseUrl,
  civilDate,
  makeRng,
  sleep,
  type BenchState,
  type BenchUser,
  type HouseholdState,
  type Rng,
} from './common.js';

const SEED = 20240607;
const SEED_PORT = 3999;
const BIG_EXPENSES = 3000;
const BIG_SETTLEMENTS = 150;
const BIG_INCOMES = 300;
const BIG_SPAN_DAYS = 3 * 365;
const SEED_CONCURRENCY = 4;

const { values: args } = parseArgs({
  options: {
    reset: { type: 'boolean', default: false },
    'api-url': { type: 'string' },
    'skip-db': { type: 'boolean', default: false },
    expenses: { type: 'string', default: String(BIG_EXPENSES) },
    concurrency: { type: 'string', default: String(SEED_CONCURRENCY) },
  },
});

const dbUrl = benchDatabaseUrl();
const redact = (text: string): string =>
  text
    .split(dbUrl.password || '\u0000')
    .join('***')
    .split(dbUrl.href)
    .join('<bench-db-url>');

// ── 1. Database: schema + reference data ────────────────────────────────────
const prismaEnv = { ...process.env, DATABASE_URL: dbUrl.href };

const runNode = (label: string, scriptArgs: string[]): void => {
  try {
    execFileSync(process.execPath, scriptArgs, {
      cwd: ROOT_DIR,
      env: prismaEnv,
      stdio: 'pipe',
    });
  } catch (error) {
    const e = error as { stdout?: Buffer; stderr?: Buffer };
    console.error(redact(`${e.stdout?.toString() ?? ''}${e.stderr?.toString() ?? ''}`));
    throw new Error(`${label} failed`);
  }
};

const prepareDatabase = async (): Promise<void> => {
  assertBenchDb(dbUrl);
  if (args.reset) {
    console.log('Resetting bench database (DROP SCHEMA public CASCADE)...');
    const client = new pg.Client({ connectionString: dbUrl.href });
    await client.connect();
    try {
      await client.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
    } finally {
      await client.end();
    }
  }
  console.log('Applying migrations (prisma migrate deploy)...');
  runNode('prisma migrate deploy', [
    join(ROOT_DIR, 'node_modules', 'prisma', 'build', 'index.js'),
    'migrate',
    'deploy',
  ]);
  console.log('Seeding reference data (prisma/seed.ts)...');
  runNode('prisma/seed.ts', ['--import', 'tsx', join(ROOT_DIR, 'prisma', 'seed.ts')]);
};

// ── 2. Local server ─────────────────────────────────────────────────────────
let server: ChildProcess | null = null;
let serverLog = '';

const startServer = async (): Promise<string> => {
  const base = `http://127.0.0.1:${SEED_PORT}`;
  console.log(`Starting local server on :${SEED_PORT}...`);
  server = spawn(process.execPath, ['--import', 'tsx', join(ROOT_DIR, 'src', 'server.ts')], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      ...BENCH_APP_ENV,
      DATABASE_URL: dbUrl.href,
      PORT: String(SEED_PORT),
      LOG_LEVEL: 'error',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const collect = (chunk: Buffer): void => {
    serverLog = (serverLog + chunk.toString()).slice(-4000);
  };
  server.stdout?.on('data', collect);
  server.stderr?.on('data', collect);
  let exited = false;
  server.on('exit', () => {
    exited = true;
  });
  for (let i = 0; i < 200; i++) {
    if (exited) throw new Error(`Local server exited early:\n${redact(serverLog)}`);
    try {
      const res = await fetch(`${base}/health`);
      if (res.ok) return base;
    } catch {
      /* not listening yet */
    }
    await sleep(250);
  }
  throw new Error(`Local server did not become healthy:\n${redact(serverLog)}`);
};

const stopServer = (): void => {
  server?.kill();
  server = null;
};

// ── 3. Dataset ──────────────────────────────────────────────────────────────
interface Member {
  user: BenchUser;
  token: string;
}

const must = async <T = Record<string, unknown>>(
  what: string,
  call: Promise<{ status: number; body: unknown }>,
  okStatus = 201,
): Promise<T> => {
  const res = await call;
  if (res.status !== okStatus) {
    throw new Error(`${what}: HTTP ${res.status} ${JSON.stringify(res.body).slice(0, 400)}`);
  }
  return res.body as T;
};

/** Runs `tasks` with at most `limit` in flight, preserving nothing about order. */
const pool = async (
  limit: number,
  tasks: (() => Promise<void>)[],
  label: string,
): Promise<void> => {
  let next = 0;
  let done = 0;
  const worker = async (): Promise<void> => {
    while (next < tasks.length) {
      const task = tasks[next++]!;
      await task();
      done++;
      if (done % 500 === 0) console.log(`  ${label}: ${done}/${tasks.length}`);
    }
  };
  await Promise.all(Array.from({ length: limit }, worker));
};

const DESCRIPTIONS = [
  'Supermercado',
  'Verduleria',
  'Carniceria',
  'Farmacia',
  'Expensas',
  'Luz',
  'Gas',
  'Internet',
  'Netflix',
  'Cena afuera',
  'Delivery',
  'Nafta',
  'Peaje',
  'Uber',
  'Cine',
  'Libreria',
  'Ferreteria',
  'Veterinaria',
  'Regalo cumple',
  'Limpieza',
];

const cents = (c: number): string => `${Math.floor(c / 100)}.${String(c % 100).padStart(2, '0')}`;

/** Splits `total` cents into `parts` positive integers, deterministically. */
const randomCuts = (rng: Rng, total: number, parts: number): number[] => {
  const weights = Array.from({ length: parts }, () => rng.int(1, 10));
  const sum = weights.reduce((a, b) => a + b, 0);
  const out = weights.map((w) => Math.floor((total * w) / sum));
  out[0]! += total - out.reduce((a, b) => a + b, 0);
  return out;
};

const subset = (rng: Rng, ids: string[]): string[] => {
  if (rng.chance(0.5)) return ids;
  const size = rng.int(2, ids.length);
  const pool = [...ids];
  const chosen: string[] = [];
  while (chosen.length < size) chosen.push(pool.splice(rng.int(0, pool.length - 1), 1)[0]!);
  return chosen;
};

const buildExpense = (
  rng: Rng,
  members: Member[],
  categoryIds: string[],
  end: Date,
  span: number,
) => {
  const ids = members.map((m) => m.user.id);
  const payer = rng.pick(members);
  // Log-uniform between ARS 1,500.00 and ARS 150,000.00.
  const totalCents = Math.floor(150_000 * Math.pow(100, rng.next()));
  const participants = subset(rng, ids);
  const splitType = rng.pick(['equal', 'equal', 'exact', 'percentage', 'shares'] as const);

  let split: object[];
  if (splitType === 'equal') {
    split = participants.map((userId) => ({ userId }));
  } else if (splitType === 'exact') {
    const parts = randomCuts(rng, totalCents, participants.length);
    split = participants.map((userId, i) => ({ userId, amount: cents(parts[i]!) }));
  } else if (splitType === 'percentage') {
    const parts = randomCuts(rng, 100, participants.length);
    split = participants.map((userId, i) => ({ userId, percentage: parts[i]! }));
  } else {
    split = participants.map((userId) => ({ userId, shares: rng.int(1, 3) }));
  }

  const date = new Date(end.getTime() - rng.int(0, span - 1) * 86_400_000);
  return {
    token: payer.token,
    body: {
      description: `${rng.pick(DESCRIPTIONS)} #${rng.int(1, 999)}`,
      ...(rng.chance(0.2) ? { notes: 'Nota de prueba para el benchmark' } : {}),
      amount: cents(totalCents),
      currencyCode: 'ARS',
      expenseDate: civilDate(date),
      ...(rng.chance(0.9) ? { categoryId: rng.pick(categoryIds) } : {}),
      paidBy: payer.user.id,
      splitType,
      participants: split,
    },
  };
};

const seedHousehold = async (
  base: string,
  rng: Rng,
  name: string,
  owner: Member,
  others: Member[],
  counts: { expenses: number; settlements: number; incomes: number; spanDays: number },
  categoryIds: string[],
  end: Date,
  concurrency: number,
): Promise<HouseholdState> => {
  console.log(`Household "${name}": ${others.length + 1} members`);
  const household = await must<{ id: string }>(
    `create household ${name}`,
    api(base, 'POST', '/api/v1/households', {
      token: owner.token,
      body: { name, description: 'Dataset de benchmark', defaultCurrencyCode: 'ARS' },
    }),
  );
  const householdId = household.id;

  for (const member of others) {
    const invite = await must<{ token: string }>(
      `invite ${member.user.email}`,
      api(base, 'POST', `/api/v1/households/${householdId}/invitations`, {
        token: owner.token,
        body: { invitedEmail: member.user.email },
      }),
    );
    await must(
      `accept ${member.user.email}`,
      api(base, 'POST', `/api/v1/invitations/${invite.token}/accept`, { token: member.token }),
      200,
    );
  }

  const members = [owner, ...others];
  const tasks: (() => Promise<void>)[] = [];

  for (let i = 0; i < counts.expenses; i++) {
    const { token, body } = buildExpense(rng, members, categoryIds, end, counts.spanDays);
    tasks.push(async () => {
      await must(
        'create expense',
        api(base, 'POST', `/api/v1/households/${householdId}/expenses`, {
          token,
          body,
          idempotent: true,
        }),
      );
    });
  }

  for (let i = 0; i < counts.settlements; i++) {
    const from = rng.pick(members);
    const to = rng.pick(members.filter((m) => m !== from));
    const date = new Date(end.getTime() - rng.int(0, counts.spanDays - 1) * 86_400_000);
    const body = {
      fromUser: from.user.id,
      toUser: to.user.id,
      amount: cents(rng.int(500_00, 80_000_00)),
      currencyCode: 'ARS',
      settlementDate: civilDate(date),
      ...(rng.chance(0.3) ? { notes: 'Transferencia' } : {}),
    };
    tasks.push(async () => {
      await must(
        'create settlement',
        api(base, 'POST', `/api/v1/households/${householdId}/settlements`, {
          token: from.token,
          body,
          idempotent: true,
        }),
      );
    });
  }

  for (let i = 0; i < counts.incomes; i++) {
    const receiver = rng.pick(members);
    const date = new Date(end.getTime() - rng.int(0, counts.spanDays - 1) * 86_400_000);
    const body = {
      receivedBy: receiver.user.id,
      description: rng.pick(['Sueldo', 'Freelance', 'Reintegro', 'Venta usada', 'Aguinaldo']),
      amount: cents(rng.int(50_000_00, 900_000_00)),
      currencyCode: 'ARS',
      incomeDate: civilDate(date),
      ...(rng.chance(0.5) ? { categoryId: rng.pick(categoryIds) } : {}),
    };
    tasks.push(async () => {
      await must(
        'create income',
        api(base, 'POST', `/api/v1/households/${householdId}/incomes`, {
          token: receiver.token,
          body,
          idempotent: true,
        }),
      );
    });
  }

  await pool(concurrency, tasks, name);
  return {
    id: householdId,
    name,
    memberIds: members.map((m) => m.user.id),
    expenses: counts.expenses,
    settlements: counts.settlements,
    incomes: counts.incomes,
  };
};

const main = async (): Promise<void> => {
  const started = Date.now();
  if (!args['skip-db']) await prepareDatabase();
  const base = args['api-url'] ?? (await startServer());

  const rng = makeRng(SEED);
  const concurrency = Number(args.concurrency);
  const end = new Date(`${civilDate(new Date())}T00:00:00Z`);

  // 8 users: u1..u5 form the big household, u6..u8 only appear in small ones.
  const members: Member[] = [];
  for (let i = 1; i <= 8; i++) {
    const email = `bench.user${i}@bench.local`;
    const username = `bench_user${i}`;
    const res = await api(base, 'POST', '/api/v1/auth/register', {
      body: { email, username, password: BENCH_PASSWORD, displayName: `Bench User ${i}` },
    });
    if (res.status === 409) {
      throw new Error('Bench users already exist: re-run with --reset to start from an empty DB.');
    }
    if (res.status !== 201) {
      throw new Error(`register ${email}: HTTP ${res.status} ${JSON.stringify(res.body)}`);
    }
    const body = res.body as { user: { id: string }; accessToken: string };
    members.push({
      user: { id: body.user.id, email, username, password: BENCH_PASSWORD },
      token: body.accessToken,
    });
  }

  const categories = await must<{ id: string }[] | { data: { id: string }[] }>(
    'list categories',
    api(base, 'GET', '/api/v1/categories'),
    200,
  );
  const categoryIds = (Array.isArray(categories) ? categories : categories.data).map((c) => c.id);
  if (categoryIds.length === 0) throw new Error('No system categories: reference seed failed?');

  const m = (n: number): Member => members[n - 1]!;
  const bigCount = Number(args.expenses);
  const scale = bigCount / BIG_EXPENSES;

  const big = await seedHousehold(
    base,
    rng,
    'Casa Grande (bench)',
    m(1),
    [m(2), m(3), m(4), m(5)],
    {
      expenses: bigCount,
      settlements: Math.round(BIG_SETTLEMENTS * scale),
      incomes: Math.round(BIG_INCOMES * scale),
      spanDays: BIG_SPAN_DAYS,
    },
    categoryIds,
    end,
    concurrency,
  );

  const small: HouseholdState[] = [];
  const smallSpec: [string, number, number[]][] = [
    ['Pareja (bench)', 1, [6]],
    ['Depto estudiantes (bench)', 2, [7, 8]],
    ['Viaje (bench)', 6, [7]],
  ];
  for (const [name, ownerN, otherNs] of smallSpec) {
    small.push(
      await seedHousehold(
        base,
        rng,
        name,
        m(ownerN),
        otherNs.map(m),
        { expenses: 40, settlements: 5, incomes: 10, spanDays: 365 },
        categoryIds,
        end,
        concurrency,
      ),
    );
  }

  const from = new Date(end.getTime() - 365 * 86_400_000);
  const state: BenchState = {
    createdAt: new Date().toISOString(),
    seed: SEED,
    users: members.map((x) => x.user),
    bigHousehold: big,
    smallHouseholds: small,
    loginUser: m(1).user,
    analyticsRange: { from: civilDate(from), to: civilDate(end) },
  };
  writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
  console.log(
    `Done in ${((Date.now() - started) / 1000).toFixed(1)}s: big household has ` +
      `${big.expenses} expenses, ${big.settlements} settlements, ${big.incomes} incomes. ` +
      'State saved to scripts/bench/.state.json',
  );
};

try {
  await main();
} catch (error) {
  console.error(redact(error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
} finally {
  stopServer();
}
