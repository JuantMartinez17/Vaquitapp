import { z } from 'zod';
import type { ValidationSchemas } from '../../app/middleware/validate.middleware.js';

export interface RouteSpec {
  method: 'get' | 'post' | 'patch' | 'delete';
  /** OpenAPI path template, relative to the `/api/v1` server (e.g. `/households/{householdId}`). */
  path: string;
  tag: string;
  summary: string;
  /** @default true */
  auth?: boolean;
  /** Requires the `Idempotency-Key` header (D12). */
  idempotent?: boolean;
  /** `multipart/form-data` with a single `file` field, instead of `request.body`. */
  multipart?: boolean;
  request?: ValidationSchemas;
  successStatus: number;
  successDescription: string;
}

interface JsonSchema {
  type?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  allOf?: JsonSchema[];
  [key: string]: unknown;
}

interface OpenApiParameter {
  name: string;
  in: 'path' | 'query' | 'header';
  required: boolean;
  schema: JsonSchema;
}

// `.and()` (ZodIntersection) schemas — used for analytics' over-time query —
// have no `.shape` to walk directly, but their JSON Schema always comes out
// as `allOf`. Flattening the JSON Schema output covers both plain objects
// and intersections uniformly, without touching Zod internals.
const flattenObjectSchema = (
  schema: JsonSchema,
): { properties: Record<string, JsonSchema>; required: string[] } => {
  if (schema.allOf) {
    return schema.allOf.reduce<{ properties: Record<string, JsonSchema>; required: string[] }>(
      (acc, part) => {
        const flat = flattenObjectSchema(part);
        return {
          properties: { ...acc.properties, ...flat.properties },
          required: [...acc.required, ...flat.required],
        };
      },
      { properties: {}, required: [] },
    );
  }
  return { properties: schema.properties ?? {}, required: schema.required ?? [] };
};

const toParameters = (
  schema: z.ZodType | undefined,
  location: 'path' | 'query',
): OpenApiParameter[] => {
  if (!schema) return [];
  const jsonSchema = z.toJSONSchema(schema, { target: 'openapi-3.0' }) as JsonSchema;
  const { properties, required } = flattenObjectSchema(jsonSchema);
  return Object.entries(properties).map(([name, propSchema]) => ({
    name,
    in: location,
    // Path params are always present when the route matches, regardless of
    // what the Zod schema marks required; query params follow the schema.
    required: location === 'path' ? true : required.includes(name),
    schema: propSchema,
  }));
};

const errorResponseContent = {
  'application/json': {
    schema: { $ref: '#/components/schemas/Error' },
  },
};

export const buildOpenApiDocument = (routes: RouteSpec[]) => {
  const paths: Record<string, Record<string, unknown>> = {};

  for (const route of routes) {
    const pathItem = (paths[route.path] ??= {});
    const requiresAuth = route.auth !== false;

    const parameters: OpenApiParameter[] = [
      ...toParameters(route.request?.params, 'path'),
      ...toParameters(route.request?.query, 'query'),
      ...(route.idempotent
        ? [
            {
              name: 'Idempotency-Key',
              in: 'header' as const,
              required: true,
              schema: { type: 'string', format: 'uuid' },
            },
          ]
        : []),
    ];

    const requestBody = route.multipart
      ? {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                properties: { file: { type: 'string', format: 'binary' } },
                required: ['file'],
              },
            },
          },
        }
      : route.request?.body
        ? {
            required: true,
            content: {
              'application/json': {
                schema: z.toJSONSchema(route.request.body, { target: 'openapi-3.0' }),
              },
            },
          }
        : undefined;

    pathItem[route.method] = {
      tags: [route.tag],
      summary: route.summary,
      ...(requiresAuth ? { security: [{ bearerAuth: [] }] } : {}),
      ...(parameters.length > 0 ? { parameters } : {}),
      ...(requestBody ? { requestBody } : {}),
      responses: {
        [route.successStatus]: { description: route.successDescription },
        ...(requiresAuth
          ? {
              '401': {
                description: 'Missing or invalid access token',
                content: errorResponseContent,
              },
            }
          : {}),
        '422': { description: 'Validation failed', content: errorResponseContent },
        default: { description: 'Error', content: errorResponseContent },
      },
    };
  }

  return {
    openapi: '3.0.3',
    info: {
      title: 'Vaquitapp API',
      version: '1.0.0',
      description:
        'Household-first shared finances backend. See README.md for the error-code catalog, ' +
        'idempotency and rate-limiting semantics not fully expressible in OpenAPI 3.0.',
    },
    servers: [{ url: '/api/v1' }],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            error: {
              type: 'object',
              properties: {
                code: { type: 'string' },
                message: { type: 'string' },
                details: {},
              },
              required: ['code', 'message'],
            },
          },
          required: ['error'],
        },
      },
    },
    paths,
  };
};
