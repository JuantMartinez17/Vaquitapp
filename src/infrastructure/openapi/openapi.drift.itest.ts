import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { Express, Router } from 'express';
import { listRoutes, type Operation } from '../../shared/testing/route-table.js';

/**
 * Express 5 keeps `route.path` on a route layer but not the prefix a router
 * was mounted under, so mounts are recorded by patching `Router.use` BEFORE
 * the app is imported. node:test runs each file in its own process, so the
 * patch cannot leak into other tests.
 */

const mounts = new WeakMap<object, string[]>();
const routerProto = (express.Router as unknown as { prototype: Record<string, unknown> }).prototype;
const originalUse = routerProto.use as (...args: unknown[]) => unknown;
routerProto.use = function patchedUse(this: unknown, ...args: unknown[]) {
  const [first, ...rest] = args;
  if (typeof first === 'string') {
    for (const handler of rest.flat()) {
      if (typeof handler === 'function') {
        mounts.set(handler, [...(mounts.get(handler) ?? []), first]);
      }
    }
  }
  return originalUse.apply(this, args);
};

// Endpoints that exist on purpose but are not part of the client contract.
const NOT_DOCUMENTED = new Set<string>([
  // Swagger UI shell and its assets: the documentation itself.
  'get /docs',
  'get /docs/openapi.json',
  'get /docs/swagger-init.js',
]);

describe('OpenAPI document vs the real Express app', () => {
  let app: Express;
  let documented: Set<string>;

  before(async () => {
    ({ app } = await import('../../app/app.js'));
    const { routes } = await import('./openapi.spec.js');
    documented = new Set(
      routes.map((route) => {
        const prefix = (route.scope ?? 'api') === 'root' ? '' : '/api/v1';
        return `${route.method} ${prefix}${route.path}`;
      }),
    );
    const { prisma } = await import('../database/prisma.js');
    process.on('beforeExit', () => void prisma.$disconnect());
  });

  it('documents exactly the routes the app serves', () => {
    const actual = new Set(
      listRoutes(app.router as unknown as Router, (router) => mounts.get(router)).map(
        (operation: Operation) => `${operation.method} ${operation.path}`,
      ),
    );

    const undocumented = [...actual].filter(
      (key) => !documented.has(key) && !NOT_DOCUMENTED.has(key),
    );
    const phantom = [...documented].filter((key) => !actual.has(key));

    assert.deepEqual(
      undocumented,
      [],
      'routes served by the app but missing from the OpenAPI document',
    );
    assert.deepEqual(phantom, [], 'operations in the OpenAPI document that the app does not serve');
    assert.ok(actual.size > 60, 'the route walk found suspiciously few routes');
  });
});
