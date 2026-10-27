import {
  householdIdParam,
  createExpenseSchema,
  updateExpenseSchema,
  expenseIdParam,
  listExpensesQuerySchema,
} from '../../../modules/expenses/expenses.schema.js';
import {
  householdIdParam as recurringHouseholdIdParam,
  recurringExpenseIdParam,
  createRecurringExpenseSchema,
  updateRecurringExpenseSchema,
} from '../../../modules/recurring-expenses/recurring-expenses.schema.js';
import {
  expenseIdParam as attachmentsExpenseIdParam,
  attachmentIdParam,
} from '../../../modules/attachments/attachments.schema.js';
import type { RouteSpec } from '../openapi.builder.js';
import {
  Attachment,
  AttachmentDownload,
  AttachmentList,
  Expense,
  ExpensePage,
  RecurringExpense,
  RecurringExpenseList,
  UpcomingRecurringExpenseList,
} from '../response-schemas.js';

const SPLIT_RULES =
  'How `participants` is read depends on `splitType`: `equal` divides the amount evenly (send only ' +
  '`userId`); `exact` needs an `amount` per participant and they must add up to the total; ' +
  '`percentage` needs a `percentage` (0 to 100) per participant and they must add up to 100; ' +
  '`shares` needs an integer `shares` count per participant and divides proportionally. Each ' +
  'user can appear once (at most 50 participants). Leftover cents are distributed so the parts ' +
  'always add up exactly to the total. A split that does not add up is 422 `INVALID_EXPENSE_SPLIT` ' +
  'with `details: { expected, received }`.';

export const expensesRoutes: RouteSpec[] = [
  {
    operationId: 'createExpense',
    method: 'post',
    path: '/households/{householdId}/expenses',
    tag: 'Expenses',
    summary: 'Create an expense with its splits',
    description:
      'Records an expense paid by one member and split among the participants. `amount` is a ' +
      'decimal string with up to 2 decimals and must be greater than zero; `currencyCode` must be ' +
      "the household's currency; `expenseDate` is a civil date (YYYY-MM-DD); `paidBy` and every " +
      'participant must be active members; `categoryId` is optional and must be global or the ' +
      "household's. " +
      SPLIT_RULES +
      ' The expense is created `active` and counts toward balances immediately. Requires an ' +
      '`Idempotency-Key`.',
    idempotent: true,
    request: createExpenseSchema,
    success: { status: 201, description: 'Expense created', schema: Expense },
    errors: {
      422: [
        'INVALID_CURRENCY',
        'INVALID_PAYER',
        'INVALID_PARTICIPANT',
        'INVALID_CATEGORY',
        'INVALID_EXPENSE_SPLIT',
      ],
    },
  },
  {
    operationId: 'listExpenses',
    method: 'get',
    path: '/households/{householdId}/expenses',
    tag: 'Expenses',
    summary: 'List expenses',
    description:
      'Newest expense date first (ties by id), cursor-paginated. Voided expenses are excluded ' +
      'unless `includeVoided=true`; `status` filters to exactly one status (including `voided` ' +
      'or `pending`) and takes precedence over `includeVoided`. `from` and `to` are inclusive ' +
      'civil dates. `participantId` matches expenses where that user has a split. Filters ' +
      'combine with AND.',
    request: { params: householdIdParam.params, query: listExpensesQuerySchema },
    success: { status: 200, description: 'Paginated expenses', schema: ExpensePage },
  },
  {
    operationId: 'getExpense',
    method: 'get',
    path: '/households/{householdId}/expenses/{expenseId}',
    tag: 'Expenses',
    summary: 'Get expense detail',
    description: 'Works for expenses in any status, voided included.',
    request: expenseIdParam,
    success: { status: 200, description: 'Expense with its splits', schema: Expense },
    errors: { 404: ['NOT_FOUND'] },
  },
  {
    operationId: 'updateExpense',
    method: 'patch',
    path: '/households/{householdId}/expenses/{expenseId}',
    tag: 'Expenses',
    summary: 'Update an expense',
    description:
      'Partial update of `description`, `notes` (nullable), `expenseDate`, `categoryId` ' +
      '(nullable) and `paidBy`. The split is always recalculated from scratch, so `amount`, ' +
      '`splitType` and `participants` must be sent **all three together or none** (otherwise ' +
      '422, reported in `details.formErrors`). ' +
      SPLIT_RULES +
      ' A voided expense cannot be edited (409 `EXPENSE_ALREADY_VOIDED`). The currency cannot ' +
      'be changed.',
    request: updateExpenseSchema,
    success: { status: 200, description: 'Updated expense', schema: Expense },
    errors: {
      404: ['NOT_FOUND'],
      409: ['EXPENSE_ALREADY_VOIDED'],
      422: ['INVALID_PAYER', 'INVALID_PARTICIPANT', 'INVALID_CATEGORY', 'INVALID_EXPENSE_SPLIT'],
    },
  },
  {
    operationId: 'voidExpense',
    method: 'delete',
    path: '/households/{householdId}/expenses/{expenseId}',
    tag: 'Expenses',
    summary: 'Void an expense',
    description:
      'Marks the expense `voided` instead of deleting it. It stops counting in balances and ' +
      'analytics and is hidden from lists unless `includeVoided=true`. Not reversible.',
    request: expenseIdParam,
    success: { status: 204, description: 'Expense voided' },
    errors: { 404: ['NOT_FOUND'], 409: ['EXPENSE_ALREADY_VOIDED'] },
  },
  {
    operationId: 'confirmExpense',
    method: 'post',
    path: '/households/{householdId}/expenses/{expenseId}/confirm',
    tag: 'Expenses',
    summary: 'Confirm a pending recurring occurrence',
    description:
      'A recurring expense generates a `pending` occurrence on each due date. Confirming turns it ' +
      '`active` so it counts toward balances. If the payer or a participant left the household ' +
      'meanwhile it stays `pending` and the call answers 409 `INVALID_PAYER` or ' +
      '`INVALID_PARTICIPANT` (it can still be skipped).',
    request: expenseIdParam,
    success: { status: 200, description: 'Occurrence confirmed, now active', schema: Expense },
    errors: {
      404: ['NOT_FOUND'],
      409: ['RECURRING_OCCURRENCE_NOT_PENDING', 'INVALID_PAYER', 'INVALID_PARTICIPANT'],
    },
  },
  {
    operationId: 'skipExpense',
    method: 'post',
    path: '/households/{householdId}/expenses/{expenseId}/skip',
    tag: 'Expenses',
    summary: 'Skip a pending recurring occurrence',
    description: 'Voids a `pending` occurrence; it never counts toward balances.',
    request: expenseIdParam,
    success: { status: 204, description: 'Occurrence skipped (voided)' },
    errors: { 404: ['NOT_FOUND'], 409: ['RECURRING_OCCURRENCE_NOT_PENDING'] },
  },
];

export const recurringRoutes: RouteSpec[] = [
  {
    operationId: 'createRecurringExpense',
    method: 'post',
    path: '/households/{householdId}/recurring-expenses',
    tag: 'RecurringExpenses',
    summary: 'Define a recurring expense',
    description:
      'A template that generates an expense on a schedule: `frequency` is `daily`, `weekly`, ' +
      '`monthly` or `yearly`, starting at `startDate` (a civil date) and ending at the optional ' +
      '`endDate`. For `monthly`, `dayOfMonth` (1 to 31) defaults to the day of `startDate`; ' +
      'shorter months use their last day. `defaultAmount` is a decimal string greater than ' +
      'zero in the household currency. `paidBy` and the participants must be active members. ' +
      'The split is validated now, with the same rules as expenses. ' +
      SPLIT_RULES +
      ' Each generated occurrence is created as a `pending` expense that a member must ' +
      '`confirmExpense` or `skipExpense`. Requires an `Idempotency-Key`.',
    idempotent: true,
    request: createRecurringExpenseSchema,
    success: {
      status: 201,
      description: 'Recurring expense defined',
      schema: RecurringExpense,
    },
    errors: {
      422: [
        'INVALID_CURRENCY',
        'INVALID_PAYER',
        'INVALID_PARTICIPANT',
        'INVALID_CATEGORY',
        'INVALID_EXPENSE_SPLIT',
      ],
    },
  },
  {
    operationId: 'listRecurringExpenses',
    method: 'get',
    path: '/households/{householdId}/recurring-expenses',
    tag: 'RecurringExpenses',
    summary: 'List recurring expenses',
    description: 'Every non-deleted template of the household, active or not, by next run date.',
    request: recurringHouseholdIdParam,
    success: {
      status: 200,
      description: 'Recurring expenses',
      schema: RecurringExpenseList,
    },
  },
  {
    operationId: 'listUpcomingRecurringExpenses',
    method: 'get',
    path: '/households/{householdId}/recurring-expenses/upcoming',
    tag: 'RecurringExpenses',
    summary: 'List upcoming and overdue occurrences',
    description:
      'The next due date of every **active** template, soonest first. `overdue` is true when the ' +
      'date is today or earlier (the occurrence has not been generated yet). This is computed ' +
      'on request; nothing is created.',
    request: recurringHouseholdIdParam,
    success: {
      status: 200,
      description: 'Next due date per active template',
      schema: UpcomingRecurringExpenseList,
    },
  },
  {
    operationId: 'updateRecurringExpense',
    method: 'patch',
    path: '/households/{householdId}/recurring-expenses/{recurringExpenseId}',
    tag: 'RecurringExpenses',
    summary: 'Update, activate or deactivate a recurring expense',
    description:
      'Partial update of `description`, `categoryId` (nullable), `paidBy`, `endDate` (nullable) ' +
      'and `isActive`. Amount, split and schedule cannot be changed: delete the template and ' +
      'create a new one. Occurrences already generated are not affected.',
    request: updateRecurringExpenseSchema,
    success: {
      status: 200,
      description: 'Updated recurring expense',
      schema: RecurringExpense,
    },
    errors: { 404: ['NOT_FOUND'], 422: ['INVALID_PAYER', 'INVALID_CATEGORY'] },
  },
  {
    operationId: 'deleteRecurringExpense',
    method: 'delete',
    path: '/households/{householdId}/recurring-expenses/{recurringExpenseId}',
    tag: 'RecurringExpenses',
    summary: 'Delete a recurring expense',
    description: 'Soft delete: no more occurrences are generated. Expenses already generated stay.',
    request: recurringExpenseIdParam,
    success: { status: 204, description: 'Recurring expense soft-deleted' },
    errors: { 404: ['NOT_FOUND'] },
  },
];

export const attachmentsRoutes: RouteSpec[] = [
  {
    operationId: 'uploadAttachment',
    method: 'post',
    path: '/households/{householdId}/expenses/{expenseId}/attachments',
    tag: 'Attachments',
    summary: 'Upload a receipt or invoice',
    description:
      'Multipart upload with exactly one file in the `file` field. The type is detected from the ' +
      'file content (JPEG, PNG, WEBP or PDF), never from the declared Content-Type, and the size ' +
      'limit is 10 MB by default. An expense holds at most 5 attachments. Uploading a file ' +
      'identical to one already attached to the expense returns that existing attachment (still ' +
      '201) instead of storing a copy. Voided expenses cannot get attachments. The server limits ' +
      'concurrent uploads: on 503 `UPLOAD_CAPACITY_EXCEEDED` retry after `Retry-After`.',
    multipart: true,
    request: attachmentsExpenseIdParam,
    success: {
      status: 201,
      description: 'Attachment stored (or the identical existing one)',
      schema: Attachment,
    },
    errors: {
      400: ['BAD_REQUEST'],
      404: ['NOT_FOUND'],
      413: ['ATTACHMENT_TOO_LARGE'],
      415: ['UNSUPPORTED_MEDIA_TYPE'],
      422: ['TOO_MANY_ATTACHMENTS'],
      503: ['UPLOAD_CAPACITY_EXCEEDED'],
    },
  },
  {
    operationId: 'listAttachments',
    method: 'get',
    path: '/households/{householdId}/expenses/{expenseId}/attachments',
    tag: 'Attachments',
    summary: 'List attachments for an expense',
    description: 'Oldest first. Deleted attachments are not listed.',
    request: attachmentsExpenseIdParam,
    success: { status: 200, description: 'Attachments', schema: AttachmentList },
    errors: { 404: ['NOT_FOUND'] },
  },
  {
    operationId: 'getAttachmentDownloadUrl',
    method: 'get',
    path: '/households/{householdId}/expenses/{expenseId}/attachments/{attachmentId}/download',
    tag: 'Attachments',
    summary: 'Get a short-lived download URL for an attachment',
    description:
      'Returns a presigned URL valid for `expiresInSeconds` (5 minutes). Fetch it right away ' +
      'without the Authorization header: the URL itself is the authorization. Request a new one ' +
      'when it expires.',
    request: attachmentIdParam,
    success: {
      status: 200,
      description: 'Presigned URL, valid for 5 minutes',
      schema: AttachmentDownload,
    },
    errors: { 404: ['NOT_FOUND'] },
  },
  {
    operationId: 'deleteAttachment',
    method: 'delete',
    path: '/households/{householdId}/expenses/{expenseId}/attachments/{attachmentId}',
    tag: 'Attachments',
    summary: 'Delete an attachment',
    description: 'Removes the attachment and its stored file.',
    request: attachmentIdParam,
    success: { status: 204, description: 'Attachment deleted' },
    errors: { 404: ['NOT_FOUND'] },
  },
];
