/**
 * Runs the API image under a tiny-instance resource profile and measures it.
 *
 *   npx tsx scripts/bench/run.ts --image bench-baseline --memory 512m --cpus 0.1
 *
 * `--image` is a tag of `vaquitapp-api` (a full reference such as
 * `myrepo/api:1.2` is used as-is). Requires a seeded bench database
 * (seed.ts) and Docker. The container is always removed at the end.
 *
 * Measured: cold boot (docker run -> first 200 on /health), idle and peak
 * memory (docker stats), sequential latency (p50/p95/max) per endpoint, and
 * a concurrent burst on the balances endpoint. Results go to stdout as a
 * markdown table and to scripts/bench/results/<tag>-<timestamp>.json.
 */
import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { parseArgs } from 'node:util';
import {
  BENCH_APP_ENV,
  RESULTS_DIR,
  api,
  benchDatabaseUrl,
  readState,
  sleep,
  type BenchState,
} from './common.js';

const { values: args } = parseArgs({
  options: {
    image: { type: 'string' },
    memory: { type: 'string', default: '512m' },
    cpus: { type: 'string', default: '0.1' },
    requests: { type: 'string', default: '30' },
    'burst-concurrency': { type: 'string', default: '10' },
    'burst-rounds': { type: 'string', default: '5' },
    port: { type: 'string', default: '3456' },
    'db-host': { type: 'string', default: 'host.docker.internal' },
    'log-level': { type: 'string', default: 'info' },
    'boot-timeout': { type: 'string', default: '180' },
    'stats-interval': { type: 'string', default: '1' },
    keep: { type: 'boolean', default: false },
  },
});

if (!args.image) {
  console.error('Usage: npx tsx scripts/bench/run.ts --image <tag> [--memory 512m --cpus 0.1]');
  process.exit(2);
}

const imageRef = /[:/]/.test(args.image) ? args.image : `vaquitapp-api:${args.image}`;
const imageTag = imageRef.split(':').pop() ?? imageRef;
const N = Number(args.requests);
const BURST_C = Number(args['burst-concurrency']);
const BURST_ROUNDS = Number(args['burst-rounds']);
const HOST_PORT = Number(args.port);
const BASE = `http://127.0.0.1:${HOST_PORT}`;
const CONTAINER = `vaquitapp-bench-${process.pid}`;

// ── helpers ─────────────────────────────────────────────────────────────────
const docker = (dockerArgs: string[], timeoutMs = 120_000): Promise<string> =>
  new Promise((resolve, reject) => {
    execFile(
      'docker',
      dockerArgs,
      { timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) reject(new Error(`docker ${dockerArgs[0]} failed: ${stderr || err.message}`));
        else resolve(stdout);
      },
    );
  });

const quantile = (sorted: number[], q: number): number =>
  sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))] ?? 0;

const round = (n: number, digits = 1): number => Number(n.toFixed(digits));

interface Stats {
  n: number;
  errors: number;
  statuses: Record<string, number>;
  firstMs: number;
  minMs: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
  meanMs: number;
}

const summarize = (samples: { ms: number; status: number }[]): Stats => {
  const sorted = samples.map((s) => s.ms).sort((a, b) => a - b);
  const statuses: Record<string, number> = {};
  for (const s of samples) statuses[String(s.status)] = (statuses[String(s.status)] ?? 0) + 1;
  const errors = samples.filter((s) => s.status < 200 || s.status >= 300).length;
  return {
    n: samples.length,
    errors,
    statuses,
    firstMs: round(samples[0]?.ms ?? 0),
    minMs: round(sorted[0] ?? 0),
    p50Ms: round(quantile(sorted, 0.5)),
    p95Ms: round(quantile(sorted, 0.95)),
    maxMs: round(sorted[sorted.length - 1] ?? 0),
    meanMs: round(sorted.reduce((a, b) => a + b, 0) / (sorted.length || 1)),
  };
};

/** One timed request; network errors / timeouts count as status 0. */
const timed = async (
  method: string,
  path: string,
  opts: { token?: string; body?: unknown } = {},
): Promise<{ ms: number; status: number }> => {
  const t0 = performance.now();
  try {
    const res = await api(BASE, method, path, { ...opts, timeoutMs: 120_000 });
    return { ms: performance.now() - t0, status: res.status };
  } catch {
    return { ms: performance.now() - t0, status: 0 };
  }
};

/** "76.54MiB" / "1.2GiB" / "512KiB" -> MiB. */
const toMiB = (text: string): number => {
  const m = /^([\d.]+)\s*([KMG]i?B)/i.exec(text.trim());
  if (!m) return NaN;
  const value = Number(m[1]);
  const unit = m[2]!.toUpperCase();
  if (unit.startsWith('G')) return value * 1024;
  if (unit.startsWith('K')) return value / 1024;
  return value;
};

const sampleMemoryMiB = async (): Promise<number> => {
  const out = await docker(
    ['stats', '--no-stream', '--format', '{{.MemUsage}}', CONTAINER],
    30_000,
  );
  return toMiB(out.split('/')[0] ?? '');
};

// ── main ────────────────────────────────────────────────────────────────────
let envDir: string | null = null;
let started = false;
let polling = false;

const cleanup = async (): Promise<void> => {
  polling = false;
  if (envDir) {
    rmSync(envDir, { recursive: true, force: true });
    envDir = null;
  }
  if (started && !args.keep) {
    await docker(['rm', '-f', CONTAINER]).catch(() => undefined);
    started = false;
  }
};

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void cleanup().finally(() => process.exit(130));
  });
}

const run = async (): Promise<void> => {
  const state: BenchState = readState();
  const dbUrl = benchDatabaseUrl();
  const containerDbUrl = new URL(dbUrl.href);
  containerDbUrl.hostname = args['db-host']!;

  // Env goes through an env-file (deleted afterwards), not `-e` flags, so the
  // database credentials never show up in process listings or logs.
  envDir = mkdtempSync(join(tmpdir(), 'vaquitapp-bench-'));
  const envFile = join(envDir, 'env');
  const containerEnv = {
    ...BENCH_APP_ENV,
    PORT: '3000',
    LOG_LEVEL: args['log-level']!,
    DATABASE_URL: containerDbUrl.href,
  };
  writeFileSync(
    envFile,
    Object.entries(containerEnv)
      .map(([k, v]) => `${k}=${v}`)
      .join('\n'),
  );

  const sizeBytes = Number(
    (await docker(['image', 'inspect', '--format', '{{.Size}}', imageRef])).trim(),
  );

  console.log(`Image ${imageRef}, limits: ${args.memory} RAM, ${args.cpus} CPUs`);

  // (a) Cold boot: from just before `docker run` to the first 200 on /health.
  const t0 = performance.now();
  await docker([
    'run',
    '-d',
    '--name',
    CONTAINER,
    '--memory',
    args.memory!,
    '--memory-swap',
    args.memory!,
    '--cpus',
    args.cpus!,
    '--add-host',
    'host.docker.internal:host-gateway',
    '--env-file',
    envFile,
    '-p',
    `127.0.0.1:${HOST_PORT}:3000`,
    imageRef,
  ]);
  started = true;
  rmSync(envDir, { recursive: true, force: true });
  envDir = null;

  let bootMs = -1;
  const deadline = t0 + Number(args['boot-timeout']) * 1000;
  while (performance.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(2000) });
      if (res.status === 200) {
        bootMs = performance.now() - t0;
        break;
      }
    } catch {
      /* not accepting connections yet */
    }
    const status = (
      await docker(['inspect', '--format', '{{.State.Status}}', CONTAINER]).catch(() => 'unknown')
    ).trim();
    if (status !== 'running') {
      const logs = await docker(['logs', '--tail', '40', CONTAINER]).catch(() => '');
      throw new Error(`Container ${status} before /health answered:\n${logs}`);
    }
    await sleep(50);
  }
  if (bootMs < 0) {
    const logs = await docker(['logs', '--tail', '40', CONTAINER]).catch(() => '');
    throw new Error(`No 200 on /health within ${args['boot-timeout']}s:\n${logs}`);
  }
  console.log(`Booted in ${(bootMs / 1000).toFixed(2)}s`);

  // Ready check: the DB must be reachable, or every number below is noise.
  const ready = await timed('GET', '/health/ready');
  if (ready.status !== 200) {
    console.warn(`WARNING: /health/ready answered ${ready.status} (database unreachable?)`);
  }

  // (b) Idle memory, once the boot work has settled.
  await sleep(3000);
  const idleMemMiB = round(await sampleMemoryMiB());
  console.log(`Idle memory: ${idleMemMiB} MiB`);

  // (e) Peak memory: poll docker stats sequentially for the rest of the run.
  const memSamples: number[] = [idleMemMiB];
  polling = true;
  const poller = (async () => {
    while (polling) {
      try {
        const mib = await sampleMemoryMiB();
        if (Number.isFinite(mib)) memSamples.push(mib);
      } catch {
        /* container gone: the final inspect will say why */
      }
      await sleep(Number(args['stats-interval']) * 1000);
    }
  })();

  // (c) Sequential latency.
  const big = state.bigHousehold.id;
  const range = `from=${state.analyticsRange.from}&to=${state.analyticsRange.to}`;
  const loginBody = { email: state.loginUser.email, password: state.loginUser.password };
  const loginRes = await api(BASE, 'POST', '/api/v1/auth/login', { body: loginBody }).catch(
    () => null,
  );
  const token = (loginRes?.body as { accessToken?: string } | null | undefined)?.accessToken;
  if (!token) {
    throw new Error(`Setup login failed (HTTP ${loginRes?.status ?? 'network error'}).`);
  }
  const h = `/api/v1/households/${big}`;

  const scenarios: { name: string; method: string; path: string; auth: boolean; body?: unknown }[] =
    [
      {
        name: 'POST /auth/login',
        method: 'POST',
        path: '/api/v1/auth/login',
        auth: false,
        body: loginBody,
      },
      { name: 'GET balances', method: 'GET', path: `${h}/balances`, auth: true },
      {
        name: 'GET balances/simplified',
        method: 'GET',
        path: `${h}/balances/simplified`,
        auth: true,
      },
      { name: 'GET expenses (page 1)', method: 'GET', path: `${h}/expenses`, auth: true },
      { name: 'GET activity', method: 'GET', path: `${h}/activity`, auth: true },
      {
        name: 'GET analytics/summary (1y)',
        method: 'GET',
        path: `${h}/analytics/summary?${range}`,
        auth: true,
      },
      {
        name: 'GET analytics/by-member (1y)',
        method: 'GET',
        path: `${h}/analytics/by-member?${range}`,
        auth: true,
      },
    ];

  const endpoints: Record<string, Stats> = {};
  for (const sc of scenarios) {
    const samples: { ms: number; status: number }[] = [];
    for (let i = 0; i < N; i++) {
      samples.push(
        await timed(sc.method, sc.path, { token: sc.auth ? token : undefined, body: sc.body }),
      );
    }
    endpoints[sc.name] = summarize(samples);
    const s = endpoints[sc.name]!;
    console.log(`  ${sc.name}: p50 ${s.p50Ms} ms, p95 ${s.p95Ms} ms, errors ${s.errors}/${s.n}`);
  }

  // (d) Concurrency burst on balances.
  const burstSamples: { ms: number; status: number }[] = [];
  const burstStart = performance.now();
  for (let round_ = 0; round_ < BURST_ROUNDS; round_++) {
    burstSamples.push(
      ...(await Promise.all(
        Array.from({ length: BURST_C }, () => timed('GET', `${h}/balances`, { token })),
      )),
    );
  }
  const burst = {
    concurrency: BURST_C,
    rounds: BURST_ROUNDS,
    wallMs: round(performance.now() - burstStart),
    ...summarize(burstSamples),
  };
  console.log(`  burst balances: p95 ${burst.p95Ms} ms, errors ${burst.errors}/${burst.n}`);

  // Wrap up: one more memory sample after the load, stop the poller.
  const postMemMiB = round(await sampleMemoryMiB().catch(() => NaN));
  polling = false;
  await poller;
  const peakMemMiB = round(Math.max(...memSamples, Number.isFinite(postMemMiB) ? postMemMiB : 0));

  const inspect = (
    await docker([
      'inspect',
      '--format',
      '{{.State.Status}} {{.State.OOMKilled}} {{.RestartCount}}',
      CONTAINER,
    ]).catch(() => 'unknown')
  )
    .trim()
    .split(' ');
  const logs = await docker(['logs', CONTAINER]).catch(() => '');
  let serverErrorLogs = 0;
  for (const line of logs.split('\n')) {
    try {
      const entry = JSON.parse(line) as { level?: number };
      if (typeof entry.level === 'number' && entry.level >= 50) serverErrorLogs++;
    } catch {
      /* not a JSON log line */
    }
  }

  const result = {
    image: imageRef,
    timestamp: new Date().toISOString(),
    limits: { memory: args.memory, cpus: args.cpus },
    logLevel: args['log-level'],
    dataset: {
      bigHousehold: {
        expenses: state.bigHousehold.expenses,
        settlements: state.bigHousehold.settlements,
        incomes: state.bigHousehold.incomes,
      },
      analyticsRange: state.analyticsRange,
    },
    imageSizeMiB: round(sizeBytes / 1024 / 1024),
    bootMs: round(bootMs),
    memoryMiB: {
      idle: idleMemMiB,
      peak: peakMemMiB,
      afterLoad: postMemMiB,
      samples: memSamples.length,
    },
    endpoints,
    burst,
    container: {
      status: inspect[0],
      oomKilled: inspect[1] === 'true',
      restarts: Number(inspect[2] ?? 0),
      serverErrorLogs,
    },
    requestsPerEndpoint: N,
  };

  mkdirSync(RESULTS_DIR, { recursive: true });
  const stamp = result.timestamp.replace(/[:.]/g, '-');
  const file = join(RESULTS_DIR, `${imageTag.replace(/[^\w.-]/g, '_')}-${stamp}.json`);
  writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);

  const rows = [
    ...Object.entries(endpoints),
    [`burst balances (${BURST_C}x${BURST_ROUNDS})`, burst] as const,
  ];
  const lines = [
    '',
    `### ${imageRef}  (${args.memory} RAM, ${args.cpus} CPUs)`,
    '',
    '| Metric | Value |',
    '| --- | --- |',
    `| Image size | ${result.imageSizeMiB} MiB |`,
    `| Cold boot (docker run -> /health 200) | ${(bootMs / 1000).toFixed(2)} s |`,
    `| Memory idle / peak / after load | ${idleMemMiB} / ${peakMemMiB} / ${postMemMiB} MiB |`,
    `| OOM killed / restarts / server error logs | ${result.container.oomKilled} / ${result.container.restarts} / ${serverErrorLogs} |`,
    '',
    '| Scenario | n | first (ms) | p50 (ms) | p95 (ms) | max (ms) | errors |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...rows.map(
      ([name, s]) =>
        `| ${name} | ${s.n} | ${s.firstMs} | ${s.p50Ms} | ${s.p95Ms} | ${s.maxMs} | ${s.errors} |`,
    ),
    '',
    `Results: ${file}`,
  ];
  console.log(lines.join('\n'));
};

try {
  await run();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await cleanup();
}
