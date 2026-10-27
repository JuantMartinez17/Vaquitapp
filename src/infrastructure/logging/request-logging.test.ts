import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import pino from 'pino';
import {
  isHealthCheck,
  resolveRequestId,
  sanitizeUrl,
  serializeRequest,
} from './request-logging.js';
import { REDACT_PATHS } from './logger.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const resolveWith = (headerValue: string | string[] | undefined) => {
  const headers: Record<string, string> = {};
  const req = { headers: { 'x-request-id': headerValue } } as unknown as IncomingMessage;
  const res = {
    setHeader: (name: string, value: string) => {
      headers[name] = value;
    },
  } as unknown as ServerResponse;
  return { id: resolveRequestId(req, res), headers };
};

describe('resolveRequestId', () => {
  it('reuses a safe incoming id and echoes it in the response', () => {
    const { id, headers } = resolveWith('abc-123_DEF.456:7');
    assert.equal(id, 'abc-123_DEF.456:7');
    assert.equal(headers['X-Request-Id'], id);
  });

  it('generates a UUID when the header is missing', () => {
    assert.match(resolveWith(undefined).id, UUID);
  });

  it('generates a UUID when the id is longer than 128 characters', () => {
    assert.match(resolveWith('a'.repeat(129)).id, UUID);
    assert.equal(resolveWith('a'.repeat(128)).id, 'a'.repeat(128));
  });

  it('generates a UUID when the id has unsafe characters', () => {
    assert.match(resolveWith('id with spaces').id, UUID);
    assert.match(resolveWith('inject"}\n{"level":60').id, UUID);
  });
});

describe('request serializers', () => {
  it('keeps only id, method and the path (no query string, no headers)', () => {
    const serialized = serializeRequest({
      id: 'r1',
      method: 'GET',
      url: '/api/v1/files/local/key?expiresAt=1&signature=deadbeef',
      headers: { authorization: 'Bearer secret' },
    } as unknown as IncomingMessage);
    assert.deepEqual(serialized, { id: 'r1', method: 'GET', url: '/api/v1/files/local/key' });
  });

  it('masks the invitation token in the path', () => {
    assert.equal(
      sanitizeUrl('/api/v1/invitations/s3cr3t-token/accept'),
      '/api/v1/invitations/:token/accept',
    );
    assert.equal(
      sanitizeUrl('/api/v1/households/h1/invitations/i1'),
      '/api/v1/households/h1/invitations/i1',
    );
  });

  it('flags /health and /health/* so they are not logged', () => {
    const at = (url: string) => ({ url }) as IncomingMessage;
    assert.equal(isHealthCheck(at('/health')), true);
    assert.equal(isHealthCheck(at('/health/ready')), true);
    assert.equal(isHealthCheck(at('/healthy-eating')), false);
    assert.equal(isHealthCheck(at('/api/v1/households')), false);
  });
});

describe('log redaction', () => {
  it('censors credentials in headers and nested payloads', () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        lines.push(chunk.toString());
        callback();
      },
    });
    const log = pino({ redact: { paths: REDACT_PATHS, censor: '[Redacted]' } }, stream);

    log.info(
      {
        req: { headers: { authorization: 'Bearer abc', cookie: 'sid=1', accept: '*/*' } },
        body: { password: 'hunter2', refreshToken: 'rt', email: 'a@b.test' },
      },
      'probe',
    );

    const output = lines.join('');
    assert.doesNotMatch(output, /Bearer abc|sid=1|hunter2|"rt"/);
    assert.match(output, /a@b\.test/);
    assert.match(output, /\[Redacted\]/);
  });
});
