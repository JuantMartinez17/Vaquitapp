import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildPoolConfig } from './pool-config.js';

const settings = {
  DATABASE_URL: 'postgresql://u:p@host-pooler.neon.tech/db',
  DB_POOL_MAX: 5,
};

describe('buildPoolConfig', () => {
  it('sets pool size, timeouts and keep-alive', () => {
    const config = buildPoolConfig(settings);
    assert.equal(config.connectionString, settings.DATABASE_URL);
    assert.equal(config.max, 5);
    assert.equal(config.idleTimeoutMillis, 30_000);
    assert.equal(config.connectionTimeoutMillis, 10_000);
    assert.equal(config.query_timeout, 20_000);
    assert.equal(config.keepAlive, true);
  });

  it('never sends statement_timeout unless explicitly opted in (pgbouncer rejects it)', () => {
    const config = buildPoolConfig(settings);
    assert.equal('statement_timeout' in config, false);
    assert.equal(
      'statement_timeout' in buildPoolConfig({ ...settings, DB_STATEMENT_TIMEOUT_MS: undefined }),
      false,
    );
  });

  it('adds statement_timeout when DB_STATEMENT_TIMEOUT_MS is set', () => {
    const config = buildPoolConfig({ ...settings, DB_STATEMENT_TIMEOUT_MS: 15_000 });
    assert.equal(config.statement_timeout, 15_000);
  });

  it('honours DB_POOL_MAX', () => {
    assert.equal(buildPoolConfig({ ...settings, DB_POOL_MAX: 2 }).max, 2);
  });
});
