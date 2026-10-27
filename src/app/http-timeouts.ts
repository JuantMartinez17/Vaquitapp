/**
 * Upper bound on one HTTP request, applied to the server in `server.ts`.
 * Kept in its own module so code that reasons about request duration (the
 * idempotency claim takeover) derives from the same number instead of copying
 * it.
 */
export const HTTP_REQUEST_TIMEOUT_MS = 120_000;
