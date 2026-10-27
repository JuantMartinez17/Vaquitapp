import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { envSchema } from './config.js';

const SECRET_A = 'a'.repeat(32);
const SECRET_B = 'b'.repeat(32);

const base = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db?schema=public',
  JWT_ACCESS_SECRET: SECRET_A,
  JWT_REFRESH_SECRET: SECRET_B,
  LOCAL_STORAGE_SECRET: SECRET_A,
};

const production = {
  ...base,
  NODE_ENV: 'production',
  STORAGE_PROVIDER: 's3',
  S3_ENDPOINT: 'https://acct.r2.cloudflarestorage.com',
  S3_REGION: 'auto',
  S3_BUCKET: 'bucket',
  S3_ACCESS_KEY_ID: 'key',
  S3_SECRET_ACCESS_KEY: 'secret',
  CORS_ORIGINS: 'https://app.vaquitapp.example',
};

const failingPaths = (input: Record<string, unknown>): string[] => {
  const result = envSchema.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => String(issue.path[0]));
};

describe('envSchema', () => {
  it('applies sane defaults for a minimal development environment', () => {
    const result = envSchema.parse(base);
    assert.equal(result.PORT, 3000);
    assert.equal(result.DB_POOL_MAX, 5);
    assert.equal(result.UPLOAD_CONCURRENCY, 2);
    assert.equal(result.DB_STATEMENT_TIMEOUT_MS, undefined);
    assert.deepEqual(result.CORS_ORIGINS, ['http://localhost:5173']);
  });

  it('parses PORT as an integer within the valid range', () => {
    assert.equal(envSchema.parse({ ...base, PORT: '10000' }).PORT, 10000);
    assert.deepEqual(failingPaths({ ...base, PORT: '3000.5' }), ['PORT']);
    assert.deepEqual(failingPaths({ ...base, PORT: '70000' }), ['PORT']);
    assert.deepEqual(failingPaths({ ...base, PORT: 'abc' }), ['PORT']);
  });

  it('rejects a DATABASE_URL that is not a postgres connection string', () => {
    assert.deepEqual(failingPaths({ ...base, DATABASE_URL: 'mysql://u:p@host/db' }), [
      'DATABASE_URL',
    ]);
    assert.equal(
      envSchema.safeParse({ ...base, DATABASE_URL: 'postgres://u:p@host/db' }).success,
      true,
    );
  });

  it('rejects malformed JWT TTLs at boot instead of at the first login', () => {
    assert.deepEqual(failingPaths({ ...base, JWT_ACCESS_TTL: '15 minutes' }), ['JWT_ACCESS_TTL']);
    assert.deepEqual(failingPaths({ ...base, JWT_REFRESH_TTL: '30' }), ['JWT_REFRESH_TTL']);
    assert.equal(envSchema.safeParse({ ...base, JWT_REFRESH_TTL: '7d' }).success, true);
  });

  it('splits CORS_ORIGINS on commas, trimming blanks and dropping empties', () => {
    const result = envSchema.parse({
      ...base,
      CORS_ORIGINS: ' https://a.example , ,https://b.example,',
    });
    assert.deepEqual(result.CORS_ORIGINS, ['https://a.example', 'https://b.example']);
  });

  it('requires the S3 variables when STORAGE_PROVIDER=s3', () => {
    assert.deepEqual(failingPaths({ ...base, STORAGE_PROVIDER: 's3' }).sort(), [
      'S3_ACCESS_KEY_ID',
      'S3_BUCKET',
      'S3_ENDPOINT',
      'S3_REGION',
      'S3_SECRET_ACCESS_KEY',
    ]);
  });

  it('requires LOCAL_STORAGE_SECRET when STORAGE_PROVIDER=local', () => {
    const { LOCAL_STORAGE_SECRET: _omitted, ...withoutSecret } = base;
    assert.deepEqual(failingPaths(withoutSecret), ['LOCAL_STORAGE_SECRET']);
  });

  describe('in production', () => {
    it('accepts a complete production configuration', () => {
      assert.equal(envSchema.safeParse(production).success, true);
    });

    it('rejects the local storage provider', () => {
      const input = { ...production, STORAGE_PROVIDER: 'local' };
      assert.ok(failingPaths(input).includes('STORAGE_PROVIDER'));
    });

    it('rejects CORS origins that are all localhost', () => {
      const input = { ...production, CORS_ORIGINS: 'http://localhost:5173, http://127.0.0.1:3000' };
      assert.deepEqual(failingPaths(input), ['CORS_ORIGINS']);
    });

    it('accepts a localhost origin as long as a real one is present too', () => {
      const input = { ...production, CORS_ORIGINS: 'http://localhost:5173,https://app.example' };
      assert.equal(envSchema.safeParse(input).success, true);
    });

    it('rejects identical access and refresh secrets', () => {
      const input = { ...production, JWT_REFRESH_SECRET: SECRET_A };
      assert.deepEqual(failingPaths(input), ['JWT_REFRESH_SECRET']);
    });

    it('does not apply these rules outside production', () => {
      const input = { ...base, NODE_ENV: 'development', JWT_REFRESH_SECRET: SECRET_A };
      assert.equal(envSchema.safeParse(input).success, true);
    });
  });
});
