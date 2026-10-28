import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

// IDs we are willing to echo back in a header and write into logs: bounded
// length and a conservative charset, so a hostile X-Request-Id cannot inject
// log lines, header splitting or megabytes of noise.
const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

/**
 * Reuses the caller's X-Request-Id when it is safe, otherwise generates one.
 * Also returns it in the response so a client report can be matched to logs.
 */
export const resolveRequestId = (req: IncomingMessage, res: ServerResponse): string => {
  const incoming = req.headers['x-request-id'];
  const candidate = Array.isArray(incoming) ? incoming[0] : incoming;
  const id = candidate !== undefined && SAFE_REQUEST_ID.test(candidate) ? candidate : randomUUID();
  res.setHeader('X-Request-Id', id);
  return id;
};

/**
 * Keeps credentials out of the logged URL: query strings can carry a signed
 * download signature, and the invitation token travels in the path.
 */
export const sanitizeUrl = (url: string | undefined): string => {
  const path = (url ?? '').split('?')[0] ?? '';
  // Anchored so household-scoped /households/:id/invitations/... keeps its ids.
  return path.replace(/^(\/api\/v1)?\/invitations\/[^/]+/, '$1/invitations/:token');
};

/** Minimal request shape for logs: enough to find a request, nothing more. */
export const serializeRequest = (req: IncomingMessage & { id?: unknown }) => ({
  id: req.id,
  method: req.method,
  url: sanitizeUrl(req.url),
});

export const serializeResponse = (res: ServerResponse) => ({ statusCode: res.statusCode });

/** Liveness/readiness probes fire every few seconds and would drown real traffic. */
export const isHealthCheck = (req: IncomingMessage): boolean =>
  req.url === '/health' || (req.url?.startsWith('/health/') ?? false);
