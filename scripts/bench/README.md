# Benchmark harness (tiny-instance fitness)

Measures whether the API is fit for a very small instance (Render Free is
roughly 512 MB RAM and 0.1 CPU). It runs a Docker image of the API under
those limits against a seeded Postgres and reports boot time, memory and
latency. It is parameterized by image tag, so you can run it for two git refs
and compare.

Files:

| File          | Purpose                                                                  |
| ------------- | ------------------------------------------------------------------------ |
| `seed.ts`     | Migrates the bench DB and fills it through the HTTP API.                 |
| `run.ts`      | Starts an image with CPU/RAM limits, measures it, always removes it.     |
| `common.ts`   | Shared helpers (bench DB URL, deterministic PRNG, HTTP, state file).     |
| `.state.json` | Created by `seed.ts` (user credentials, ids, analytics window). Ignored. |
| `results/`    | One JSON per run: `<tag>-<timestamp>.json`. Ignored.                     |

## Prerequisites

- Docker, with Postgres 16 reachable on `localhost:5432` (`docker compose up -d postgres`).
- An empty database called `vaquitapp_bench` on the same server, with the same
  credentials as the `DATABASE_URL` in `.env` (the harness swaps only the database
  name). To use another server, set `BENCH_DATABASE_URL`; its database name must
  contain `bench`, otherwise the scripts refuse to run.
- `npm ci && npx prisma generate` in the checkout that holds the harness.

No secrets are printed, and the container gets its environment through a
temporary `--env-file` that is deleted right after `docker run`. The JWT and
storage secrets used by the benchmark are fixed throwaway constants in
`common.ts`.

## 1. Build one image per git ref

Build each ref from its own clean worktree so the images reflect exactly that
commit:

```bash
git worktree add ../vaquitapp-old   790a9d6        # or a branch / tag
git worktree add ../vaquitapp-new   feature/backend-hardening
docker build -t vaquitapp-api:old ../vaquitapp-old
docker build -t vaquitapp-api:new ../vaquitapp-new
```

Any tag works; `--image old` expands to `vaquitapp-api:old`, and a full
reference (`registry/name:tag`) is used as-is.

## 2. Seed the bench database (once per schema)

```bash
npx tsx scripts/bench/seed.ts --reset
```

What it does:

1. `--reset` drops and recreates the `public` schema of the bench DB (only
   allowed when the DB name contains `bench`). Without it, re-running fails with
   "Bench users already exist".
2. `prisma migrate deploy` and `prisma/seed.ts` (currencies, system categories).
3. Starts **this checkout's** server locally on port 3999 (`node --import tsx
src/server.ts`, `NODE_ENV=production`, `LOG_LEVEL=error`) and creates the
   dataset through the public API, then stops it. Seeding against a local
   server takes about 25 s; through a 0.1-CPU container it would take far longer
   and the bcrypt-heavy registrations would dominate.
4. Writes `scripts/bench/.state.json`.

Dataset (fixed PRNG seed, so the shape is identical on every run; only ids and
"today" as the end date change):

- 8 users (`bench.user1..8@bench.local`).
- "Casa Grande": 5 members, 3,000 expenses over 3 years (equal / exact /
  percentage / shares splits, random participant subsets, ~90% categorized),
  150 settlements, 300 incomes.
- 3 small households (40 expenses, 5 settlements, 10 incomes each).

Seed with the **newest** code that you intend to compare, and run the older
image against the same database. The seeded data is plain API-created data,
so an older image will work as long as the migrations it expects are a subset
of what is applied. Migrations from a newer ref are not rolled back; if the
newer ref adds migrations that the older code does not tolerate, seed
separately for each ref (`--reset`, then run).

Useful flags: `--expenses 500` (scales settlements/incomes too), `--concurrency 4`,
`--api-url http://host:port` (seed an already running server), `--skip-db`.

## 3. Run the benchmark

```bash
npx tsx scripts/bench/run.ts --image old --memory 512m --cpus 0.1
npx tsx scripts/bench/run.ts --image new --memory 512m --cpus 0.1
```

Flags: `--requests 30` (per endpoint), `--burst-concurrency 10`,
`--burst-rounds 5`, `--port 3456`, `--db-host host.docker.internal`,
`--log-level info`, `--boot-timeout 180` (seconds), `--keep` (do not remove the
container, for debugging).

What is measured:

| Metric        | How                                                                                                                                                   |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cold boot     | From just before `docker run` to the first `200` on `/health`.                                                                                        |
| Idle memory   | `docker stats --no-stream` 3 s after boot. Peak memory is the max of samples taken about every second during the run (and one after the load).        |
| Latency       | N sequential requests per scenario: login, balances, balances/simplified, expenses page 1, activity, analytics summary and by-member (last 365 days). |
| Burst         | 10 concurrent x 5 rounds on balances: p50/p95/max, wall time, errors.                                                                                 |
| Health of run | OOM-killed flag, restart count, and number of error-level (>= 50) pino log lines.                                                                     |

Output is a markdown table on stdout plus
`scripts/bench/results/<tag>-<timestamp>.json`. "first" is the very first request of
the scenario (JIT / pool warm-up); p50, p95, and max include it. p95 uses
nearest-rank. Any non-2xx or network error counts as an error.

To compare, run both tags back to back on an otherwise idle machine and diff the
two JSON files (same keys: `bootMs`, `memoryMiB`, `endpoints.*`, `burst`).

## Caveats

- **Windows / Docker Desktop**: containers run in a WSL2 VM. The database is on the
  host, reached via `host.docker.internal` (the harness also passes
  `--add-host host.docker.internal:host-gateway`, so Linux works too). Its
  added latency is the same for both images, but it is not the latency of a
  managed DB over a network.
- **CPU quota emulation**: `--cpus 0.1` is a CFS quota (10 ms of CPU per 100 ms
  period), not a slower core. Short requests look fine, CPU-heavy ones (bcrypt,
  big aggregations, JSON serialization) stall in 100 ms steps. A burst on a
  throttled container queues behind the quota, which is why burst p95 is large.
- **Noisy host**: the numbers include whatever else runs on the machine (other
  containers, test runs, the DB itself). Treat a single run as a smoke test; for
  a comparison, repeat 3 times and compare medians.
- **Memory** comes from `docker stats` (cgroup usage minus page cache), which is
  what the platform's limit is enforced against, but it is sampled, so very short
  spikes can be missed. `--memory-swap` is set equal to `--memory` to disable
  swap.
- The Postgres container itself is not limited, only the API under test.
- The auth rate limiter is raised to 1,000,000 requests (`AUTH_RATE_LIMIT_MAX`) so the
  30 logins are not answered with 429; older images that predate the variable
  ignore it.
- `ENABLE_SCHEDULER=false`, `STORAGE_PROVIDER=local`; attachments are not
  exercised.
