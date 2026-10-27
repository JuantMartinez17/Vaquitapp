import { ErrorCode } from '../../shared/errors/codes.js';

/**
 * Human description of every error code, used to word the per-operation error
 * responses. Typed as an exhaustive record: adding a code to `codes.ts`
 * without describing it here does not compile.
 */
export const ERROR_DESCRIPTIONS: Record<ErrorCode, string> = {
  BAD_REQUEST:
    'Malformed request: unparseable JSON body, a missing or malformed `Idempotency-Key`, an invalid activity cursor, or an unsupported currency code',
  UNAUTHORIZED: 'Missing, invalid or expired access token',
  FORBIDDEN: 'Authenticated but not allowed to do this',
  NOT_FOUND: 'The resource does not exist in this household (or the route does not exist)',
  CONFLICT: 'Generic conflict, for example a unique value that already exists',
  VALIDATION_ERROR:
    'The path, query or body failed validation. `details` maps each field to its problems, plus `formErrors` for problems that have no field',
  INTERNAL_ERROR: 'Unexpected server failure; details are never exposed',

  TOKEN_REUSE_DETECTED:
    'A refresh token that was already rotated was presented again. Every session of the user was revoked: send the user to the login screen',
  EMAIL_ALREADY_REGISTERED: 'An account with that email already exists',
  USERNAME_TAKEN: 'That username is already taken',
  INVALID_CREDENTIALS: 'Wrong email or password',

  HOUSEHOLD_NOT_FOUND: 'The household does not exist or was deleted',
  NOT_A_MEMBER:
    'The caller is not an active member of the household (also returned when the household does not exist or was deleted), or the targeted user is not one',
  INSUFFICIENT_ROLE: 'The action requires the `admin` role',
  LAST_ADMIN: 'The household would be left without an admin',
  MEMBER_HAS_OPEN_BALANCE:
    'The member has a non-zero net balance and must settle up first. `details.net` carries the amount',
  HOUSEHOLD_CURRENCY_LOCKED:
    'The default currency cannot change once the household has any financial record (expenses, settlements, incomes, transfers or recurring expenses, voided ones included)',

  INVITATION_NOT_FOUND: 'No invitation with that token (or id) exists',
  INVITATION_EXPIRED: 'The invitation passed its 7-day deadline',
  INVITATION_ALREADY_RESOLVED: 'The invitation was already accepted or rejected',
  INVITATION_ALREADY_PENDING: 'There already is a pending invitation for that email',
  ALREADY_MEMBER: 'The user is already an active member of the household',

  INVALID_PAYER:
    'The payer is not an active member of the household (409 when confirming a pending occurrence whose payer left)',
  INVALID_PARTICIPANT:
    'A participant is not an active member of the household (409 when confirming a pending occurrence whose participant left)',
  INVALID_EXPENSE_SPLIT:
    'The participants do not add up: exact amounts differ from the total, percentages do not sum to 100, or a required split field is missing',
  INVALID_CATEGORY: 'The category is neither global nor owned by this household',
  INVALID_CURRENCY: "The currency is not the household's currency",
  EXPENSE_ALREADY_VOIDED: 'The expense was already voided',

  INVALID_SETTLEMENT:
    'fromUser equals toUser, the amount rounds to zero, or a party is not an active member',
  SETTLEMENT_ALREADY_VOIDED: 'The settlement was already voided',

  INVALID_TRANSFER:
    'fromUser equals toUser, the amount rounds to zero, or a party is not an active member',
  INCOME_ALREADY_VOIDED: 'The income was already voided',
  TRANSFER_ALREADY_VOIDED: 'The transfer was already voided',

  RECURRING_OCCURRENCE_NOT_PENDING:
    'Only an expense with status `pending` can be confirmed or skipped',

  ATTACHMENT_TOO_LARGE: 'The file exceeds the upload limit (10 MB by default)',
  UNSUPPORTED_MEDIA_TYPE:
    'The file content is not JPEG, PNG, WEBP or PDF, or the request body uses an unsupported content encoding or charset',
  TOO_MANY_ATTACHMENTS: 'The expense already has 5 attachments',
  UPLOAD_CAPACITY_EXCEEDED:
    'The server is processing too many uploads right now. Retry after the `Retry-After` delay',

  IDEMPOTENCY_KEY_CONFLICT:
    'The `Idempotency-Key` was already used with a different body, endpoint or household',
  IDEMPOTENCY_KEY_IN_PROGRESS:
    'A request with the same `Idempotency-Key` is still being processed. Retry after the `Retry-After` delay',
  RATE_LIMITED: 'Too many requests from this IP address; see `Retry-After`',
  PAYLOAD_TOO_LARGE: 'The JSON request body exceeds 1 MB',
  SERVICE_UNAVAILABLE:
    'The database is unreachable or timed out. Retry after the `Retry-After` delay',
};
