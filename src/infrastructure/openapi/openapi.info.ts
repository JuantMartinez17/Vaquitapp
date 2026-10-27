import { ERROR_DESCRIPTIONS } from './error-catalog.js';

const errorCodeTable = Object.entries(ERROR_DESCRIPTIONS)
  .map(([code, description]) => `| \`${code}\` | ${description.replaceAll('|', '\\|')} |`)
  .join('\n');

const description = `
Backend of Vaquitapp, a shared-expenses app organised around **households**: a group of people that
share one currency, record expenses, settle debts and track income together.

This document is the contract a client (mobile or web) is built from. Every response schema in it is
verified against the real server by an automated test, so what you read here is what the API returns.

## Base URL and versioning

All operations live under \`/api/v1\`, except the two health checks (\`/health\` and \`/health/ready\`),
which are served at the server root. Requests and responses are JSON (\`application/json\`), except the
attachment upload (\`multipart/form-data\`). Property names are camelCase.

## Authentication

1. \`POST /auth/register\` or \`POST /auth/login\` returns \`{ user, accessToken, refreshToken }\`.
2. Send the access token on every protected call: \`Authorization: Bearer <accessToken>\`.
3. The **access token** is a JWT that lasts **15 minutes**. When a call answers 401 \`UNAUTHORIZED\`,
   call \`POST /auth/refresh\` with the refresh token and retry once.
4. The **refresh token** is opaque, lasts **30 days** and is **single use**: every refresh returns a new
   pair and revokes the old refresh token. Always store the newest one.
5. **Reuse detection:** presenting an already-used refresh token is treated as theft. The server revokes
   **every session** of that user and answers 401 \`TOKEN_REUSE_DETECTED\`: send the user to the login
   screen. Never fire two refreshes in parallel with the same token (serialize them in the client).
6. \`POST /auth/logout\` revokes one refresh token; \`POST /auth/logout-all\` revokes all of them.

## Households and roles

Most data is scoped to a household: \`/households/{householdId}/...\`. The caller must be an **active
member** of it; some operations need the **admin** role. A household that does not exist, was deleted,
or that the caller does not belong to always answers 403 \`NOT_A_MEMBER\` (never 404), so ids cannot be
probed. Each operation states the role it needs. A household always keeps at least one admin.

A household has a single currency (\`defaultCurrencyCode\`, ARS by default). Every amount in it uses that
currency, there is no conversion, and it cannot be changed once the household has any financial record.
People who leave stay in the history (balances flag them with \`isFormerMember\`) but cannot be picked as
payer, participant or party of new records.

## Conventions

- **Money** is a **string** with a decimal point, never a JSON number: \`"85000.00"\`. Responses print as
  many decimals as the currency has (\`Currency.decimalPlaces\`: 2 for ARS or USD, 0 for CLP). Requests
  accept up to 12 integer digits and up to 2 decimals (\`^\\d{1,12}(\\.\\d{1,2})?$\`), non-negative; the
  server rounds half-up to the currency. Net balances in responses can be negative.
- **Business dates** (\`expenseDate\`, \`incomeDate\`, \`settlementDate\`, \`transferDate\`, recurring
  \`startDate\`...) are **civil dates** \`YYYY-MM-DD\`: no time, no timezone. Years 1900 to 2100. Send the
  day the user picked, exactly as written.
- **System timestamps** (\`createdAt\`, \`updatedAt\`, \`joinedAt\`...) are ISO-8601 in **UTC**,
  for example \`2026-08-15T14:30:00.000Z\`.
- **Ids** are UUIDs. A malformed id in a path or query is a 422 \`VALIDATION_ERROR\`.
- **Pagination** is cursor-based on expenses, settlements, incomes, transfers and the activity feed:
  \`?limit=\` (1 to 100, default 20) and \`?cursor=\`. The response is \`{ "data": [...], "nextCursor": string | null }\`.
  Pass \`nextCursor\` back as \`cursor\` to get the next page; \`null\` means there is no more. Cursors of the
  four record lists are row ids (a non-UUID is a 422); the activity feed uses an opaque cursor (an
  invalid one is a 400). There is no \`page\` or \`total\`. Every other list is bounded and returned as a bare array.
- **Voiding, not deleting:** \`DELETE\` on expenses, settlements, incomes and transfers voids the record.
  Voided rows are hidden from lists unless \`?includeVoided=true\` and never count in balances or analytics.
- **Unknown fields** in a request body are rejected (422), and \`PATCH\` bodies are partial: send only
  the fields to change; nullable fields are cleared with \`null\`.
- **Tracing:** every response carries \`X-Request-Id\`. Send your own to correlate client and server logs.

## Idempotency

\`POST\` on **expenses, settlements, incomes, transfers and recurring-expenses** requires an
\`Idempotency-Key\` header (1 to 255 printable ASCII characters; a missing or malformed one is a 400).
Generate a **UUID v4 when the form opens** and reuse it for every retry of that submission, so a flaky
network cannot create duplicates.

- Same key and same body: the original 2xx response is **replayed** (same status and body) with the
  header \`Idempotency-Replayed: true\`.
- Same key with a different body, endpoint or household: 409 \`IDEMPOTENCY_KEY_CONFLICT\`.
- Same key while the first request is still running: 409 \`IDEMPOTENCY_KEY_IN_PROGRESS\` with
  \`Retry-After\`; wait and resend.
- Keys are remembered for **24 hours**. Only successful (2xx) responses are stored: after an error you
  can fix the request and resend with the same key.

The checks run in this order: authentication, path/query/body validation (422), household membership
(403), then the key (400) and its conflicts (409).

## Errors

Every failure uses the same envelope. Clients branch on \`error.code\`, never on \`error.message\`
(English, for debugging only):

\`\`\`json
{ "error": { "code": "VALIDATION_ERROR", "message": "Invalid data", "details": { "amount": ["Must be a decimal"] } } }
\`\`\`

- \`VALIDATION_ERROR\` (422): \`details\` maps each field to a list of problems, plus an optional
  \`formErrors: string[]\` for problems without a field (unknown keys, rules across fields).
- \`MEMBER_HAS_OPEN_BALANCE\` (409): \`details.net\` is the member's net balance.
- 400 \`BAD_REQUEST\` is a malformed request (unparseable JSON, bad \`Idempotency-Key\`, bad activity
  cursor); 413 \`PAYLOAD_TOO_LARGE\` is a JSON body over 1 MB; 415 \`UNSUPPORTED_MEDIA_TYPE\` is an
  unsupported content encoding or an unaccepted attachment type.
- 503 \`SERVICE_UNAVAILABLE\` (database down or slow) and 503 \`UPLOAD_CAPACITY_EXCEEDED\` carry
  \`Retry-After\`. Retry those with backoff; do not retry other 4xx without changing the request.
- Unmapped uniqueness violations are 409 \`CONFLICT\`.

### Error codes

| Code | Meaning |
| --- | --- |
${errorCodeTable}

## Rate limiting

Limits are per client IP and answer 429 \`RATE_LIMITED\` with \`Retry-After\` (seconds):

- a global ceiling on all of \`/api/v1\` (300 requests per minute by default);
- login counts only **failed** attempts; register and refresh have their own budgets.

Every limited response carries the standard \`RateLimit-Limit\`, \`RateLimit-Remaining\`,
\`RateLimit-Reset\` and \`RateLimit-Policy\` headers of the limiter that last handled it.

## Health checks

\`GET /health\` is liveness: it answers 200 without touching the database. \`GET /health/ready\` is
readiness: it pings the database and answers 503 when it cannot. Neither needs authentication nor
counts against the rate limit.
`.trim();

export const OPENAPI_INFO = {
  title: 'Vaquitapp API',
  version: '1.0.0',
  description,
};

export const OPENAPI_TAGS = [
  {
    name: 'Auth',
    description:
      'Registration, login and token rotation. Public except `logout-all`; rate limited per IP.',
  },
  { name: 'Users', description: 'The authenticated user: profile and received invitations.' },
  {
    name: 'Households',
    description:
      'Create and manage households and their members. Roles: `admin` (manage the household) and `member`.',
  },
  {
    name: 'Invitations',
    description:
      'Invite people by email (admin) and accept or reject an invitation (the invitee). Invitations expire after 7 days.',
  },
  {
    name: 'Categories',
    description: 'Global system categories plus the custom categories of each household.',
  },
  {
    name: 'Expenses',
    description:
      'Shared expenses and how they are split among members: `equal`, `exact`, `percentage` or `shares`.',
  },
  {
    name: 'Settlements',
    description: 'Payments between two members that reduce what they owe each other.',
  },
  { name: 'Balances', description: 'Derived net balance per member and a minimal debt graph.' },
  {
    name: 'Incomes',
    description: 'Money received by a member. Informational: does not move balances.',
  },
  {
    name: 'Transfers',
    description: 'Money moved between two members. Informational: does not move balances.',
  },
  {
    name: 'Activity',
    description: 'Unified, newest-first feed of expenses, incomes, transfers and settlements.',
  },
  {
    name: 'RecurringExpenses',
    description:
      'Templates that generate a `pending` expense on each due date, to be confirmed or skipped.',
  },
  {
    name: 'Attachments',
    description: 'Receipts and invoices (JPEG, PNG, WEBP or PDF) attached to an expense.',
  },
  {
    name: 'Analytics',
    description: 'Aggregates over an explicit date range of at most 366 days.',
  },
  { name: 'Currencies', description: 'Catalog of supported currencies.' },
  { name: 'Files', description: 'Download endpoint behind the local-development storage.' },
  { name: 'Health', description: 'Liveness and readiness probes, served outside `/api/v1`.' },
];
