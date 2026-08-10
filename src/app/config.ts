import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().url(),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('30d'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
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
  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const requiredForProvider: Record<'local' | 's3', string[]> = {
  local: ['LOCAL_STORAGE_SECRET'],
  s3: ['S3_REGION', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'],
};

const missing = requiredForProvider[parsed.data.STORAGE_PROVIDER].filter(
  (key) => !parsed.data[key as keyof typeof parsed.data],
);
if (missing.length > 0) {
  console.error(
    `❌ STORAGE_PROVIDER=${parsed.data.STORAGE_PROVIDER} requires: ${missing.join(', ')}`,
  );
  process.exit(1);
}

export const env = parsed.data;
