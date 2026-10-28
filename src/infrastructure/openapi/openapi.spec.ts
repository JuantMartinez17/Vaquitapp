import { buildOpenApiDocument, type RouteSpec } from './openapi.builder.js';
import { OPENAPI_INFO, OPENAPI_TAGS } from './openapi.info.js';
import { schemaRegistry } from './response-schemas.js';
import { authRoutes } from './routes/auth.openapi.js';
import { householdsRoutes, invitationsRoutes } from './routes/households.openapi.js';
import { catalogRoutes } from './routes/catalog.openapi.js';
import { attachmentsRoutes, expensesRoutes, recurringRoutes } from './routes/expenses.openapi.js';
import {
  activityRoutes,
  analyticsRoutes,
  balancesRoutes,
  incomesRoutes,
  settlementsRoutes,
  transfersRoutes,
} from './routes/ledger.openapi.js';
import { platformRoutes } from './routes/platform.openapi.js';

/**
 * Declarative source of truth for the generated OpenAPI document: one entry
 * per operation, reusing the exact Zod schemas each route validates requests
 * with and the response schemas the contract test checks real responses
 * against, so the document cannot drift from either.
 */
export const routes: RouteSpec[] = [
  ...authRoutes,
  ...householdsRoutes,
  ...invitationsRoutes,
  ...catalogRoutes.filter((route) => route.tag === 'Categories'),
  ...expensesRoutes,
  ...settlementsRoutes,
  ...balancesRoutes,
  ...incomesRoutes,
  ...transfersRoutes,
  ...activityRoutes,
  ...recurringRoutes,
  ...attachmentsRoutes,
  ...analyticsRoutes,
  ...catalogRoutes.filter((route) => route.tag === 'Currencies'),
  ...platformRoutes,
];

export const openApiDocument = buildOpenApiDocument({
  routes,
  registry: schemaRegistry,
  info: OPENAPI_INFO,
  tags: OPENAPI_TAGS,
});
