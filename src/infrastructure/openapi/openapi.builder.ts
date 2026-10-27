import { z } from 'zod';
import type { ValidationSchemas } from '../../app/middleware/validate.middleware.js';
import { civilDateSchema } from '../../shared/validation/civil-date.schema.js';
import { ErrorCode } from '../../shared/errors/codes.js';
import { ERROR_DESCRIPTIONS } from './error-catalog.js';
import type { SchemaRegistry } from './response-schemas.js';

export type ErrorStatus = 400 | 401 | 403 | 404 | 409 | 413 | 415 | 422 | 429 | 500 | 503;

export interface SuccessSpec {
  status: number;
  description: string;
  /** A schema registered in the response registry. Omit for bodiless (204) responses. */
  schema?: z.ZodType;
  /** Media type of the body; defaults to `application/json`. */
  contentType?: string;
  /** The body is a raw file, not JSON. */
  binary?: boolean;
}

export interface RouteSpec {
  /** Unique, camelCase (e.g. `createExpense`). Client generators name their methods after it. */
  operationId: string;
  method: 'get' | 'post' | 'patch' | 'delete';
  /** OpenAPI path template, relative to the `/api/v1` server unless `scope` is `root`. */
  path: string;
  tag: string;
  summary: string;
  /** Markdown. Behaviour and rules; the builder appends the access requirement. */
  description: string;
  /** `false` for public operations. @default true */
  auth?: boolean;
  /** Household-scoped operations are member-only; this raises it to household admin. */
  role?: 'admin';
  /** Requires the `Idempotency-Key` header. */
  idempotent?: boolean;
  /** `multipart/form-data` with a single `file` field, instead of `request.body`. */
  multipart?: boolean;
  /** The real Zod schemas the route validates with. */
  request?: ValidationSchemas;
  success: SuccessSpec;
  /** Extra responses besides the 2xx. Whatever the middleware stack implies is added by the builder. */
  extraResponses?: { status: number; description: string; schema: z.ZodType }[];
  /** Codes this operation's own logic can return, by status; merged with the implied ones. */
  errors?: Partial<Record<ErrorStatus, ErrorCode[]>>;
  /** `root`: served outside `/api/v1` (health checks). @default 'api' */
  scope?: 'api' | 'root';
}

export interface OpenApiInput {
  routes: RouteSpec[];
  registry: SchemaRegistry;
  info: { title: string; version: string; description: string };
  tags: { name: string; description: string }[];
}

type JsonSchema = Record<string, unknown>;

export interface ResolvedResponse {
  status: number;
  description: string;
  /** Error codes this status may carry; empty for success responses. */
  codes: ErrorCode[];
  schema?: z.ZodType;
  contentType?: string;
  binary?: boolean;
  headers: string[];
}

const CIVIL_DATE_PATTERN = '^\\d{4}-\\d{2}-\\d{2}$';
const FORMATS_WITH_REDUNDANT_PATTERN = new Set(['uuid', 'date-time', 'email', 'uri']);
const DEFAULT_PAGE_LIMIT = 20;

const ERROR_LABELS: Record<ErrorStatus, string> = {
  400: 'Bad request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not found',
  409: 'Conflict',
  413: 'Payload too large',
  415: 'Unsupported media type',
  422: 'Validation failed',
  429: 'Too many requests',
  500: 'Unexpected server error',
  503: 'Service unavailable',
};

const PARAM_DESCRIPTIONS: Record<string, string> = {
  householdId: 'Household id.',
  userId: 'Id of the household member.',
  invitationId: 'Invitation id.',
  token: 'Invitation token (the secret of the invite link).',
  categoryId: 'Category id.',
  expenseId: 'Expense id.',
  settlementId: 'Settlement id.',
  incomeId: 'Income id.',
  transferId: 'Transfer id.',
  recurringExpenseId: 'Recurring expense id.',
  attachmentId: 'Attachment id.',
  key: 'Storage key from the signed download URL (already URL-encoded in that URL).',
  limit: 'Page size, 1 to 100.',
  cursor:
    'Pass the previous response `nextCursor` to get the next page. Treat it as opaque; omit it for the first page.',
  includeVoided: 'Include voided rows, which are hidden by default.',
  from: 'First day of the range, inclusive (YYYY-MM-DD).',
  to: 'Last day of the range, inclusive (YYYY-MM-DD).',
  status: 'Return only expenses in this status. Overrides `includeVoided`.',
  paidBy: 'Only expenses paid by this user.',
  participantId: 'Only expenses where this user has a split.',
  granularity: 'Bucket size of the series.',
  expiresAt: 'Expiry of the link, in epoch milliseconds (from the signed URL).',
  signature: 'HMAC signature of the link (from the signed URL).',
};

// ── JSON Schema post-processing ────────────────────────────────────────────

/**
 * Zod emits things the OpenAPI 3.0 Schema Object does not allow (`$id`) or
 * that only add noise (the long regexes it attaches next to `format: uuid`).
 */
const cleanSchema = (node: unknown): unknown => {
  if (Array.isArray(node)) {
    return node.map(cleanSchema);
  }
  if (node === null || typeof node !== 'object') {
    return node;
  }
  const out: JsonSchema = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === '$id' || key === '$schema') {
      continue;
    }
    out[key] = cleanSchema(value);
  }
  if (typeof out.format === 'string' && FORMATS_WITH_REDUNDANT_PATTERN.has(out.format)) {
    delete out.pattern;
  }
  if (out.pattern === CIVIL_DATE_PATTERN && out.format === undefined) {
    out.format = 'date';
  }
  return out;
};

/** Requests are described by what the client may send (`input`): defaults are optional, not required. */
const requestJsonSchema = (schema: z.ZodType): JsonSchema =>
  cleanSchema(
    z.toJSONSchema(schema, {
      target: 'openapi-3.0',
      io: 'input',
      unrepresentable: 'any',
      override: (ctx) => {
        // The refinement that checks it is a real calendar day is invisible to
        // JSON Schema, which would leave the field as an anonymous string.
        if (ctx.zodSchema === civilDateSchema) {
          Object.assign(ctx.jsonSchema, {
            type: 'string',
            format: 'date',
            pattern: CIVIL_DATE_PATTERN,
          });
        }
      },
    }),
  ) as JsonSchema;

// `.and()` (ZodIntersection) schemas, used by analytics' over-time query, come
// out as `allOf`; flattening covers both plain objects and intersections.
const flattenObjectSchema = (
  schema: JsonSchema,
): { properties: Record<string, JsonSchema>; required: string[] } => {
  const allOf = schema.allOf as JsonSchema[] | undefined;
  if (allOf) {
    return allOf.reduce<{ properties: Record<string, JsonSchema>; required: string[] }>(
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
  return {
    properties: (schema.properties as Record<string, JsonSchema> | undefined) ?? {},
    required: (schema.required as string[] | undefined) ?? [],
  };
};

interface OpenApiParameter {
  name: string;
  in: 'path' | 'query' | 'header';
  required: boolean;
  description?: string;
  schema: JsonSchema;
}

const toParameters = (
  schema: z.ZodType | undefined,
  location: 'path' | 'query',
): OpenApiParameter[] => {
  if (!schema) return [];
  const { properties, required } = flattenObjectSchema(requestJsonSchema(schema));
  return Object.entries(properties).map(([name, propSchema]) => {
    const withDefault: JsonSchema =
      name === 'limit' ? { ...propSchema, default: DEFAULT_PAGE_LIMIT } : propSchema;
    const description = PARAM_DESCRIPTIONS[name];
    return {
      name,
      in: location,
      // Path params are always present when the route matches; query params
      // are required only when the schema says so (defaulted ones are not).
      required: location === 'path' ? true : required.includes(name),
      ...(description ? { description } : {}),
      schema: withDefault,
    };
  });
};

// ── Responses ──────────────────────────────────────────────────────────────

const unique = <T>(items: T[]): T[] => [...new Set(items)];

const isHouseholdScoped = (route: RouteSpec): boolean =>
  route.path.startsWith('/households/{householdId}');

const hasValidation = (route: RouteSpec): boolean =>
  Boolean(route.request?.body || route.request?.params || route.request?.query);

/**
 * The statuses and error codes an operation can return: what its own logic
 * declares in `errors`, plus what the middleware stack in front of it implies
 * (auth, household membership, body parsing, validation, rate limiting, the
 * database). Shared by the document builder and the contract test, so a test
 * checks a response against exactly what the document promises.
 */
export const resolveResponses = (route: RouteSpec): ResolvedResponse[] => {
  const isApi = (route.scope ?? 'api') === 'api';
  const requiresAuth = route.auth !== false;
  const hasJsonBody = Boolean(route.request?.body);
  const explicit = route.errors ?? {};

  const implied: Partial<Record<ErrorStatus, ErrorCode[]>> = {
    400: hasJsonBody || route.idempotent ? [ErrorCode.BAD_REQUEST] : [],
    401: requiresAuth ? [ErrorCode.UNAUTHORIZED] : [],
    403: isHouseholdScoped(route)
      ? [ErrorCode.NOT_A_MEMBER, ...(route.role === 'admin' ? [ErrorCode.INSUFFICIENT_ROLE] : [])]
      : [],
    // Any write can hit a unique index nothing maps to a specific code, and
    // the error middleware answers that as a generic CONFLICT.
    409: [
      ...(route.idempotent
        ? [ErrorCode.IDEMPOTENCY_KEY_CONFLICT, ErrorCode.IDEMPOTENCY_KEY_IN_PROGRESS]
        : []),
      ...(isApi && route.method !== 'get' ? [ErrorCode.CONFLICT] : []),
    ],
    413: hasJsonBody ? [ErrorCode.PAYLOAD_TOO_LARGE] : [],
    415: hasJsonBody ? [ErrorCode.UNSUPPORTED_MEDIA_TYPE] : [],
    422: hasValidation(route) ? [ErrorCode.VALIDATION_ERROR] : [],
    429: isApi ? [ErrorCode.RATE_LIMITED] : [],
    500: isApi ? [ErrorCode.INTERNAL_ERROR] : [],
    503: isApi ? [ErrorCode.SERVICE_UNAVAILABLE] : [],
  };

  const responses: ResolvedResponse[] = [
    {
      status: route.success.status,
      description: route.success.description,
      codes: [],
      schema: route.success.schema,
      contentType:
        route.success.schema || route.success.binary
          ? (route.success.contentType ??
            (route.success.binary ? 'application/octet-stream' : 'application/json'))
          : undefined,
      binary: route.success.binary,
      headers: ['X-Request-Id', ...(route.idempotent ? ['Idempotency-Replayed'] : [])],
    },
  ];

  for (const extra of route.extraResponses ?? []) {
    responses.push({
      status: extra.status,
      description: extra.description,
      codes: [],
      schema: extra.schema,
      contentType: 'application/json',
      headers: ['X-Request-Id'],
    });
  }

  const statuses = unique([...Object.keys(implied), ...Object.keys(explicit)])
    .map(Number)
    .sort((a, b) => a - b) as ErrorStatus[];

  for (const status of statuses) {
    const codes = unique([...(implied[status] ?? []), ...(explicit[status] ?? [])]);
    if (codes.length === 0 || responses.some((r) => r.status === status)) {
      continue;
    }
    const retryAfter =
      codes.includes(ErrorCode.RATE_LIMITED) ||
      codes.includes(ErrorCode.SERVICE_UNAVAILABLE) ||
      codes.includes(ErrorCode.UPLOAD_CAPACITY_EXCEEDED) ||
      codes.includes(ErrorCode.IDEMPOTENCY_KEY_IN_PROGRESS);
    responses.push({
      status,
      description: [
        ERROR_LABELS[status],
        '',
        ...codes.map((code) => `- \`${code}\`: ${ERROR_DESCRIPTIONS[code]}`),
      ].join('\n'),
      codes,
      contentType: 'application/json',
      headers: [
        'X-Request-Id',
        ...(retryAfter ? ['Retry-After'] : []),
        ...(codes.includes(ErrorCode.RATE_LIMITED)
          ? ['RateLimit-Limit', 'RateLimit-Remaining', 'RateLimit-Reset', 'RateLimit-Policy']
          : []),
      ],
    });
  }

  return responses.sort((a, b) => a.status - b.status);
};

const HEADER_COMPONENTS: Record<string, JsonSchema> = {
  'X-Request-Id': {
    description:
      'Correlation id of the request. Echoes the `X-Request-Id` the client sent, or a generated one. Quote it when reporting a problem.',
    schema: { type: 'string' },
  },
  'Retry-After': {
    description: 'Seconds to wait before retrying.',
    schema: { type: 'integer', minimum: 0 },
  },
  'Idempotency-Replayed': {
    description:
      'Present with value `true` when this response is a stored replay of an earlier request with the same `Idempotency-Key`, rather than a fresh execution.',
    schema: { type: 'string', enum: ['true'] },
  },
  'RateLimit-Limit': {
    description: 'Requests allowed in the current window by the limiter that answered.',
    schema: { type: 'integer' },
  },
  'RateLimit-Remaining': {
    description: 'Requests left in the current window.',
    schema: { type: 'integer' },
  },
  'RateLimit-Reset': {
    description: 'Seconds until the current window resets.',
    schema: { type: 'integer' },
  },
  'RateLimit-Policy': {
    description: 'Quota policy of the limiter, as `<limit>;w=<window seconds>`.',
    schema: { type: 'string', example: '300;w=60' },
  },
};

const headerRef = (name: string): JsonSchema => ({ $ref: `#/components/headers/${name}` });

const schemaRef = (registry: SchemaRegistry, schema: z.ZodType): JsonSchema => {
  const meta = registry.get(schema);
  if (!meta) {
    throw new Error('A response schema used by an operation is not registered as a component');
  }
  return { $ref: `#/components/schemas/${meta.id}` };
};

const accessLine = (route: RouteSpec): string => {
  if (route.auth === false) {
    return '**Access:** public, no access token needed.';
  }
  if (isHouseholdScoped(route)) {
    return route.role === 'admin'
      ? '**Access:** household admin. Anyone who is not an active member of the household, or whose household does not exist or was deleted, gets 403 `NOT_A_MEMBER`.'
      : '**Access:** any active member of the household. Anyone who is not one, or whose household does not exist or was deleted, gets 403 `NOT_A_MEMBER`.';
  }
  return '**Access:** any authenticated user.';
};

const capitalize = (value: string): string => value.charAt(0).toUpperCase() + value.slice(1);

// ── Document ───────────────────────────────────────────────────────────────

export const buildOpenApiDocument = ({ routes, registry, info, tags }: OpenApiInput) => {
  const paths: Record<string, Record<string, unknown>> = {};
  const requestSchemas: Record<string, JsonSchema> = {};
  const seenOperationIds = new Set<string>();

  for (const route of routes) {
    if (seenOperationIds.has(route.operationId)) {
      throw new Error(`Duplicate operationId: ${route.operationId}`);
    }
    seenOperationIds.add(route.operationId);

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
              description:
                'Makes the request safe to retry. 1 to 255 printable ASCII characters; generate a UUID v4 when the form opens and reuse it for every retry of that submission. ' +
                'Repeating a key with the same body replays the original 2xx response (with `Idempotency-Replayed: true`); a different body, endpoint or household is 409 `IDEMPOTENCY_KEY_CONFLICT`. Keys live 24 hours; error responses are not stored.',
              schema: {
                type: 'string',
                minLength: 1,
                maxLength: 255,
                pattern: '^[\\x20-\\x7e]{1,255}$',
              },
            },
          ]
        : []),
    ];

    let requestBody: unknown;
    if (route.multipart) {
      const name = `${capitalize(route.operationId)}Request`;
      requestSchemas[name] = {
        type: 'object',
        properties: {
          file: {
            type: 'string',
            format: 'binary',
            description:
              'JPEG, PNG, WEBP or PDF, at most 10 MB by default. The type is detected from the content, not from the declared Content-Type.',
          },
        },
        required: ['file'],
      };
      requestBody = {
        required: true,
        content: { 'multipart/form-data': { schema: { $ref: `#/components/schemas/${name}` } } },
      };
    } else if (route.request?.body) {
      const name = `${capitalize(route.operationId)}Request`;
      requestSchemas[name] = requestJsonSchema(route.request.body);
      requestBody = {
        required: true,
        content: { 'application/json': { schema: { $ref: `#/components/schemas/${name}` } } },
      };
    }

    const responses: Record<string, unknown> = {};
    for (const response of resolveResponses(route)) {
      const isError = response.codes.length > 0;
      const bodySchema = isError
        ? { $ref: '#/components/schemas/Error' }
        : response.binary
          ? { type: 'string', format: 'binary' }
          : response.schema
            ? schemaRef(registry, response.schema)
            : undefined;
      responses[String(response.status)] = {
        description: response.description,
        headers: Object.fromEntries(response.headers.map((name) => [name, headerRef(name)])),
        ...(bodySchema && response.contentType
          ? { content: { [response.contentType]: { schema: bodySchema } } }
          : {}),
      };
    }

    pathItem[route.method] = {
      operationId: route.operationId,
      tags: [route.tag],
      summary: route.summary,
      description: `${route.description}\n\n${accessLine(route)}`,
      ...(requiresAuth ? { security: [{ bearerAuth: [] }] } : { security: [] }),
      ...(route.scope === 'root'
        ? { servers: [{ url: '/', description: 'Server root, outside the /api/v1 prefix' }] }
        : {}),
      ...(parameters.length > 0 ? { parameters } : {}),
      ...(requestBody ? { requestBody } : {}),
      responses,
    };
  }

  const registered = z.toJSONSchema(registry, {
    target: 'openapi-3.0',
    io: 'output',
    unrepresentable: 'any',
    uri: (id) => `#/components/schemas/${id}`,
  });

  const schemas = Object.fromEntries(
    Object.entries({
      ...(cleanSchema(registered.schemas) as Record<string, JsonSchema>),
      ...requestSchemas,
    }).sort(([a], [b]) => a.localeCompare(b)),
  );

  return {
    openapi: '3.0.3',
    info,
    servers: [{ url: '/api/v1', description: 'API v1. Health checks live at the server root.' }],
    tags,
    paths,
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description:
            'Access token from `/auth/register`, `/auth/login` or `/auth/refresh`, sent as `Authorization: Bearer <accessToken>`. Valid for 15 minutes.',
        },
      },
      headers: HEADER_COMPONENTS,
      schemas,
    },
  };
};
