import assert from 'node:assert/strict';
import { resolveResponses, type RouteSpec } from '../../infrastructure/openapi/openapi.builder.js';
import { ErrorResponse } from '../../infrastructure/openapi/response-schemas.js';
import { ErrorCode } from '../errors/codes.js';

/**
 * Helper for the OpenAPI contract test (not a test file itself: no
 * `.test.ts`/`.itest.ts` suffix). It checks a real HTTP response against what
 * the document promises for one operation, resolved through the same
 * `resolveResponses` the document builder uses, so a wrong schema attached to
 * an operation, an undocumented status or an undeclared error code fails here.
 */

export interface ObservedResponse {
  status: number;
  body: unknown;
  text: string;
  headers: Record<string, string | string[] | undefined>;
}

interface CheckOptions {
  /** Accept an empty array/page. By default a list must have items, because `[]` satisfies any item schema. */
  allowEmpty?: boolean;
}

const RETRY_AFTER_CODES: ErrorCode[] = [
  ErrorCode.RATE_LIMITED,
  ErrorCode.SERVICE_UNAVAILABLE,
  ErrorCode.UPLOAD_CAPACITY_EXCEEDED,
  ErrorCode.IDEMPOTENCY_KEY_IN_PROGRESS,
];

const header = (response: ObservedResponse, name: string): string | undefined => {
  const value = response.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
};

const hasItems = (body: unknown): boolean => {
  if (Array.isArray(body)) {
    return body.length > 0;
  }
  if (typeof body === 'object' && body !== null && 'data' in body) {
    return Array.isArray(body.data) && body.data.length > 0;
  }
  return true;
};

export const createContractChecker = (routes: RouteSpec[]) => {
  const byOperation = new Map(routes.map((route) => [route.operationId, route]));
  const succeeded = new Set<string>();
  const observed = new Set<string>();

  const check = (operationId: string, response: ObservedResponse, options: CheckOptions = {}) => {
    const route = byOperation.get(operationId);
    assert.ok(route, `Unknown operationId: ${operationId}`);

    const documented = resolveResponses(route);
    const expected = documented.find((candidate) => candidate.status === response.status);
    assert.ok(
      expected,
      `${operationId} answered ${response.status}, which the document does not declare ` +
        `(declared: ${documented.map((candidate) => candidate.status).join(', ')}). ` +
        `Body: ${response.text.slice(0, 300)}`,
    );

    assert.ok(
      header(response, 'X-Request-Id'),
      `${operationId} ${response.status}: missing X-Request-Id`,
    );

    if (expected.codes.length > 0) {
      const parsed = ErrorResponse.parse(response.body);
      assert.ok(
        expected.codes.includes(parsed.error.code),
        `${operationId} ${response.status} returned ${parsed.error.code}, declared: ${expected.codes.join(', ')}`,
      );
      if (RETRY_AFTER_CODES.includes(parsed.error.code)) {
        assert.ok(
          header(response, 'Retry-After'),
          `${operationId}: ${parsed.error.code} without Retry-After`,
        );
      }
      if (parsed.error.code === ErrorCode.RATE_LIMITED) {
        for (const name of expected.headers.filter((h) => h.startsWith('RateLimit-'))) {
          assert.ok(header(response, name), `${operationId}: 429 without ${name}`);
        }
      }
    } else if (expected.binary) {
      assert.ok(response.text.length > 0 || Buffer.isBuffer(response.body), 'empty file body');
    } else if (expected.schema) {
      assert.match(header(response, 'Content-Type') ?? '', /application\/json/);
      expected.schema.parse(response.body);
      if (!options.allowEmpty) {
        assert.ok(hasItems(response.body), `${operationId}: list is empty, nothing was verified`);
      }
    } else {
      assert.equal(response.text, '', `${operationId} ${response.status} must have no body`);
    }

    observed.add(operationId);
    if (response.status >= 200 && response.status < 300) {
      succeeded.add(operationId);
    }
  };

  return {
    check,
    /** Operations that answered with their declared 2xx at least once. */
    succeeded,
    allOperationIds: [...byOperation.keys()],
  };
};
