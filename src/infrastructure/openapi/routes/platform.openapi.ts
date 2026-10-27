import { z } from 'zod';
import type { RouteSpec } from '../openapi.builder.js';
import { HealthLive, HealthNotReady, HealthReady } from '../response-schemas.js';

// The route validates these inline in local-files.routes.ts without exporting
// the schema; rebuilt here to describe the parameters.
const localFileRequest = {
  params: z.object({ key: z.string().min(1) }),
  query: z.object({ expiresAt: z.coerce.number(), signature: z.string().min(1) }),
};

export const platformRoutes: RouteSpec[] = [
  {
    operationId: 'downloadLocalFile',
    method: 'get',
    path: '/files/local/{key}',
    tag: 'Files',
    summary: 'Download a file from local development storage',
    description:
      'Only exists when the server runs with local storage (development). With S3 storage the ' +
      'download URL from `getAttachmentDownloadUrl` points straight to the bucket and this call ' +
      'is never used. Do not build URLs by hand: use the signed URL exactly as returned. It ' +
      'needs no Authorization header; the `expiresAt` and `signature` query parameters are the ' +
      'authorization.',
    auth: false,
    request: localFileRequest,
    success: {
      status: 200,
      description: 'The raw file content',
      binary: true,
    },
    errors: { 401: ['UNAUTHORIZED'], 404: ['NOT_FOUND'] },
  },
  {
    operationId: 'getHealth',
    method: 'get',
    path: '/health',
    tag: 'Health',
    summary: 'Liveness probe',
    description:
      'Answers 200 as long as the process is up. It does not touch the database, so it is safe ' +
      'for a platform health check. Served at the server root, outside `/api/v1`.',
    auth: false,
    scope: 'root',
    success: { status: 200, description: 'The process is alive', schema: HealthLive },
  },
  {
    operationId: 'getReadiness',
    method: 'get',
    path: '/health/ready',
    tag: 'Health',
    summary: 'Readiness probe',
    description:
      'Pings the database with a 2-second timeout. 200 when it answers, 503 when it fails or ' +
      'hangs. The 503 body is **not** the error envelope. Served at the server root, outside ' +
      '`/api/v1`.',
    auth: false,
    scope: 'root',
    success: { status: 200, description: 'The database answers', schema: HealthReady },
    extraResponses: [
      {
        status: 503,
        description: 'The database is unreachable or too slow',
        schema: HealthNotReady,
      },
    ],
  },
];
