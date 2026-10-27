import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import SwaggerParser from '@apidevtools/swagger-parser';
import { ErrorCode } from '../../shared/errors/codes.js';
import { normalizeLineEndings, renderOpenApiYaml } from '../../shared/testing/openapi-yaml.js';
import { resolveResponses } from './openapi.builder.js';
import { openApiDocument, routes } from './openapi.spec.js';

type Operation = {
  operationId: string;
  tags: string[];
  summary: string;
  description: string;
  security?: unknown[];
  parameters?: { name: string; in: string; required: boolean; schema: Record<string, unknown> }[];
  responses: Record<string, { description: string; content?: unknown }>;
};

const operations = Object.entries(openApiDocument.paths).flatMap(([path, item]) =>
  Object.entries(item as Record<string, Operation>).map(([method, operation]) => ({
    path,
    method,
    operation,
  })),
);

const find = (operationId: string): Operation => {
  const found = operations.find((entry) => entry.operation.operationId === operationId);
  assert.ok(found, `operation ${operationId} is not in the document`);
  return found.operation;
};

describe('OpenAPI document', () => {
  it('is a valid OpenAPI 3.0 document with resolvable references', async () => {
    // validate() dereferences in place, so it gets a copy.
    await SwaggerParser.validate(structuredClone(openApiDocument) as never);
  });

  it('gives every operation a unique camelCase id, a tag, a summary and a description', () => {
    const ids = operations.map((entry) => entry.operation.operationId);
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(ids.length, routes.length);
    const tagNames = new Set(openApiDocument.tags.map((tag) => tag.name));
    for (const { path, method, operation } of operations) {
      const label = `${method} ${path}`;
      assert.match(operation.operationId, /^[a-z][A-Za-z0-9]*$/, label);
      assert.ok(operation.summary.length > 0, `${label}: summary`);
      assert.ok(operation.description.length > 40, `${label}: description`);
      assert.ok(
        operation.tags.every((tag) => tagNames.has(tag)),
        `${label}: tag is declared`,
      );
      assert.ok(operation.security !== undefined, `${label}: security is explicit`);
    }
  });

  it('marks public operations with an empty security requirement', () => {
    assert.deepEqual(find('loginUser').security, []);
    assert.deepEqual(find('listCurrencies').security, []);
    assert.deepEqual(find('createExpense').security, [{ bearerAuth: [] }]);
  });

  it('exposes every error code as an enum on the Error schema', () => {
    const error = openApiDocument.components.schemas.Error as {
      properties: { error: { properties: { code: { enum: string[] } } } };
    };
    assert.deepEqual(
      [...error.properties.error.properties.code.enum].sort(),
      Object.values(ErrorCode).sort(),
    );
  });

  it('does not mark defaulted parameters as required', () => {
    const overTime = find('getAnalyticsOverTime');
    const granularity = overTime.parameters?.find((p) => p.name === 'granularity');
    assert.equal(granularity?.required, false);
    assert.equal(granularity?.schema.default, 'day');
    const limit = find('listExpenses').parameters?.find((p) => p.name === 'limit');
    assert.equal(limit?.required, false);
    assert.equal(limit?.schema.default, 20);
  });

  it('requires Idempotency-Key exactly where the app does', () => {
    const idempotent = operations
      .filter((entry) =>
        entry.operation.parameters?.some((p) => p.name === 'Idempotency-Key' && p.required),
      )
      .map((entry) => entry.operation.operationId)
      .sort();
    assert.deepEqual(idempotent, [
      'createExpense',
      'createIncome',
      'createRecurringExpense',
      'createSettlement',
      'createTransfer',
    ]);
  });

  it('describes the specific error codes of each declared error status', () => {
    const create = find('createExpense');
    assert.match(create.responses['422']!.description, /`INVALID_EXPENSE_SPLIT`/);
    assert.match(create.responses['409']!.description, /`IDEMPOTENCY_KEY_CONFLICT`/);
    assert.match(find('leaveHousehold').responses['409']!.description, /`MEMBER_HAS_OPEN_BALANCE`/);
    assert.match(
      find('updateHousehold').responses['409']!.description,
      /`HOUSEHOLD_CURRENCY_LOCKED`/,
    );
    for (const route of routes) {
      for (const response of resolveResponses(route)) {
        for (const code of response.codes) {
          assert.ok(
            find(route.operationId).responses[String(response.status)]!.description.includes(code),
            `${route.operationId} ${response.status} names ${code}`,
          );
        }
      }
    }
  });

  it('declares the documented headers as reusable components', () => {
    const headers = Object.keys(openApiDocument.components.headers);
    for (const name of [
      'X-Request-Id',
      'Retry-After',
      'Idempotency-Replayed',
      'RateLimit-Limit',
      'RateLimit-Remaining',
      'RateLimit-Reset',
    ]) {
      assert.ok(headers.includes(name), name);
    }
  });

  it('matches the committed openapi.yaml (run `npm run openapi:export` after an API change)', async () => {
    const file = resolve(import.meta.dirname, '..', '..', '..', 'openapi.yaml');
    const committed = normalizeLineEndings(await readFile(file, 'utf8'));
    assert.equal(committed, await renderOpenApiYaml(openApiDocument, file));
  });
});
