import type { Router } from 'express';

/**
 * Lists every method + path an Express 5 router tree serves (test support,
 * see openapi.drift.itest.ts). Express keeps `route.path` on a route layer but
 * not the prefix a sub-router was mounted under, so the caller supplies those
 * through `mountsOf` (recorded by wrapping `Router.use` before the app loads).
 */

export interface Operation {
  method: string;
  /** Full path in OpenAPI form, e.g. `/api/v1/households/{householdId}`. */
  path: string;
}

interface RouteLayer {
  route?: { path: string; methods: Record<string, boolean> };
  handle: unknown;
}

const isRouter = (handle: unknown): handle is Router & { stack: RouteLayer[] } =>
  typeof handle === 'function' && Array.isArray((handle as { stack?: unknown }).stack);

const toOpenApiPath = (path: string): string => path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');

const join = (prefix: string, path: string): string =>
  `${prefix}${path === '/' ? '' : path}` || '/';

export const listRoutes = (
  router: Router,
  mountsOf: (child: Router) => string[] | undefined,
  prefix = '',
): Operation[] => {
  const operations: Operation[] = [];
  for (const layer of (router as unknown as { stack: RouteLayer[] }).stack) {
    if (layer.route) {
      for (const method of Object.keys(layer.route.methods)) {
        if (method !== '_all') {
          operations.push({
            method,
            path: toOpenApiPath(join(prefix, layer.route.path)),
          });
        }
      }
    } else if (isRouter(layer.handle)) {
      // `app.use(router)` mounts at '/', which adds nothing to the prefix.
      for (const mount of mountsOf(layer.handle) ?? ['/']) {
        operations.push(
          ...listRoutes(layer.handle, mountsOf, `${prefix}${mount === '/' ? '' : mount}`),
        );
      }
    }
  }
  return operations;
};
