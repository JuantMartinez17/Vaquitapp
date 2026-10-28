import 'dotenv/config';
import { z } from 'zod';
import { parseDurationMs } from '../shared/utils/duration.js';

// A malformed TTL would otherwise surface as a 500 on the first login
// (jsonwebtoken / parseDurationMs throwing at request time).
const durationString = (fallback: string) =>
  z
    .string()
    .default(fallback)
    .refine(
      (value) => {
        try {
          parseDurationMs(value);
          return true;
        } catch {
          return false;
        }
      },
      { message: 'Expected a duration like 45s, 15m, 12h or 30d' },
    );

const positiveInt = (fallback: number) => z.coerce.number().int().positive().default(fallback);

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '0.0.0.0']);

const isLocalOrigin = (origin: string): boolean => {
  try {
    return LOCAL_HOSTNAMES.has(new URL(origin).hostname);
  } catch {
    // Not a parseable URL (e.g. a bare `*`): not a safe production origin either.
    return false;
  }
};

const REQUIRED_FOR_PROVIDER = {
  local: ['LOCAL_STORAGE_SECRET'],
  s3: ['S3_ENDPOINT', 'S3_REGION', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'],
} as const;

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    DATABASE_URL: z
      .string()
      .url()
      .refine((value) => /^postgres(ql)?:\/\//.test(value), {
        message: 'Expected a postgres:// or postgresql:// connection string',
      }),
    JWT_ACCESS_SECRET: z.string().min(32),
    JWT_REFRESH_SECRET: z.string().min(32),
    JWT_ACCESS_TTL: durationString('15m'),
    JWT_REFRESH_TTL: durationString('30d'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    // Comma-separated list. Trimmed and de-blanked so "a, b," or a trailing
    // comma never yields an empty-string origin.
    CORS_ORIGINS: z
      .string()
      .default('http://localhost:5173')
      .transform((value) =>
        value
          .split(',')
          .map((origin) => origin.trim())
          .filter((origin) => origin.length > 0),
      ),

    // Database pool. Sized for a tiny instance behind Neon's pgbouncer
    // (pooled URL): few connections, and no server-side statement_timeout
    // unless explicitly opted in, because pgbouncer rejects unsupported
    // startup parameters (see infrastructure/database/prisma.ts).
    DB_POOL_MAX: positiveInt(5),
    DB_STATEMENT_TIMEOUT_MS: z.coerce.number().int().positive().optional(),

    // Rate limiting on /auth/*: the brute-force/credential-stuffing surface.
    // The window is shared; each endpoint has its own budget. The test suite
    // raises every limit (scripts/test-env.mjs) since fixture setup alone
    // (registerTestUser) makes dozens of real /auth calls per file.
    AUTH_RATE_LIMIT_WINDOW_MS: positiveInt(15 * 60 * 1000),
    // Login counts failed attempts only.
    AUTH_RATE_LIMIT_MAX: positiveInt(20),
    AUTH_REGISTER_RATE_LIMIT_MAX: positiveInt(20),
    // Higher on purpose: every signed-in client refreshes every ~15 minutes,
    // and several users can share one IP (NAT).
    AUTH_REFRESH_RATE_LIMIT_MAX: positiveInt(120),
    // Light global limiter on /api/v1, per IP.
    API_RATE_LIMIT_WINDOW_MS: positiveInt(60 * 1000),
    API_RATE_LIMIT_MAX: positiveInt(300),
    // Recurring-expense generation job — must be true on exactly one service
    // instance, or a scaled-out deployment would generate duplicate
    // occurrences. z.coerce.boolean() is NOT used here: it treats the string
    // "false" as truthy, which would silently enable every instance.
    ENABLE_SCHEDULER: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),

    // Attachments (D7): FileStorage has one implementation per provider; the
    // domain layer never imports either SDK directly.
    STORAGE_PROVIDER: z.enum(['local', 's3']).default('local'),
    MAX_UPLOAD_BYTES: z.coerce
      .number()
      .positive()
      .default(10 * 1024 * 1024),
    // Signs the short-lived download URLs LocalFileStorage hands out, so a
    // dev environment without real S3 still has to prove authorization before
    // a file is served, instead of the path alone being enough.
    LOCAL_STORAGE_SECRET: z.string().min(32).optional(),
    LOCAL_STORAGE_DIR: z.string().default('./uploads'),
    // Required whenever STORAGE_PROVIDER=s3 (see requiredForProvider below).
    // S3FileStorage passes this straight to the SDK, and an absent endpoint
    // silently means "AWS" — so an S3-compatible provider (R2, Supabase,
    // MinIO) would fail on the first upload at runtime instead of at boot.
    S3_ENDPOINT: z.string().url().optional(),
    S3_REGION: z.string().optional(),
    S3_BUCKET: z.string().optional(),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    // Concurrent uploads allowed in flight. Each one buffers up to
    // MAX_UPLOAD_BYTES in memory, so on a 512 MB instance this is the knob
    // that bounds the worst-case heap spike.
    UPLOAD_CONCURRENCY: positiveInt(2),
    S3_FORCE_PATH_STYLE: z
      .enum(['true', 'false'])
      .default('true')
      .transform((v) => v === 'true'),
  })
  .superRefine((value, ctx) => {
    for (const key of REQUIRED_FOR_PROVIDER[value.STORAGE_PROVIDER]) {
      if (!value[key]) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `Required when STORAGE_PROVIDER=${value.STORAGE_PROVIDER}`,
        });
      }
    }

    if (value.NODE_ENV !== 'production') {
      return;
    }
    // Production guard rails: each of these is a config that boots fine and
    // then misbehaves quietly (files lost on an ephemeral disk, a browser
    // origin that can never match, one leaked secret forging both token kinds).
    if (value.STORAGE_PROVIDER !== 's3') {
      ctx.addIssue({
        code: 'custom',
        path: ['STORAGE_PROVIDER'],
        message: 'Must be "s3" in production: the local disk is ephemeral',
      });
    }
    if (value.CORS_ORIGINS.every(isLocalOrigin)) {
      ctx.addIssue({
        code: 'custom',
        path: ['CORS_ORIGINS'],
        message: 'Must include at least one non-localhost origin in production',
      });
    }
    if (value.JWT_ACCESS_SECRET === value.JWT_REFRESH_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['JWT_REFRESH_SECRET'],
        message: 'Must differ from JWT_ACCESS_SECRET',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:', z.flattenError(parsed.error).fieldErrors);
  process.exit(1);
}

export const env: Env = parsed.data;
