import { z } from 'zod';
import { paginationQuerySchema } from '../../../shared/utils/pagination.js';
import {
  householdIdParam as settlementsHouseholdIdParam,
  settlementIdParam,
  createSettlementSchema,
  listSettlementsQuerySchema,
} from '../../../modules/settlements/settlements.schema.js';
import {
  householdIdParam as incomesHouseholdIdParam,
  incomeIdParam,
  createIncomeSchema,
  updateIncomeSchema,
  listIncomesQuerySchema,
} from '../../../modules/incomes/incomes.schema.js';
import {
  householdIdParam as transfersHouseholdIdParam,
  transferIdParam,
  createTransferSchema,
  listTransfersQuerySchema,
} from '../../../modules/transfers/transfers.schema.js';
import { dateRangeSchema, overTimeSchema } from '../../../modules/analytics/analytics.schema.js';
import type { RouteSpec } from '../openapi.builder.js';
import {
  ActivityPage,
  AnalyticsComparison,
  AnalyticsSummary,
  Balances,
  CategorySpendList,
  Income,
  IncomePage,
  MemberSpendList,
  Settlement,
  SettlementPage,
  SimplifiedBalances,
  TimeSeries,
  Transfer,
  TransferPage,
} from '../response-schemas.js';

// The balances and activity routes define their `{ params: { householdId } }`
// schema inline in their routes files instead of exporting it, so it is
// rebuilt here rather than exported solely for this document's sake.
const householdIdOnly = { params: z.object({ householdId: z.string().uuid() }) };

const DATE_RANGE =
  '`from` and `to` are required civil dates (YYYY-MM-DD), inclusive; `from` must not be after ' +
  '`to` and the range cannot exceed 366 days (otherwise 422). Only active expenses and ' +
  'non-voided incomes count. There is no unbounded analytics call.';

export const settlementsRoutes: RouteSpec[] = [
  {
    operationId: 'createSettlement',
    method: 'post',
    path: '/households/{householdId}/settlements',
    tag: 'Settlements',
    summary: 'Record a settlement between two members',
    description:
      '`fromUser` paid `amount` to `toUser`, reducing what they owe each other. The caller must ' +
      'be one of the two parties (otherwise 403 `FORBIDDEN`); both must be active members and ' +
      'different. `amount` is a decimal string with up to 2 decimals, greater than zero, in the ' +
      "household's currency; `settlementDate` is a civil date. Created as `confirmed` and " +
      'counted in balances at once. Requires an `Idempotency-Key`.',
    idempotent: true,
    request: createSettlementSchema,
    success: { status: 201, description: 'Settlement recorded', schema: Settlement },
    errors: { 403: ['FORBIDDEN'], 422: ['INVALID_SETTLEMENT', 'INVALID_CURRENCY'] },
  },
  {
    operationId: 'listSettlements',
    method: 'get',
    path: '/households/{householdId}/settlements',
    tag: 'Settlements',
    summary: 'List settlements',
    description:
      'Newest settlement date first, cursor-paginated. Voided settlements are hidden unless ' +
      '`includeVoided=true`.',
    request: { params: settlementsHouseholdIdParam.params, query: listSettlementsQuerySchema },
    success: { status: 200, description: 'Paginated settlements', schema: SettlementPage },
  },
  {
    operationId: 'getSettlement',
    method: 'get',
    path: '/households/{householdId}/settlements/{settlementId}',
    tag: 'Settlements',
    summary: 'Get settlement detail',
    description: 'Works for settlements in any status, voided included.',
    request: settlementIdParam,
    success: { status: 200, description: 'Settlement', schema: Settlement },
    errors: { 404: ['NOT_FOUND'] },
  },
  {
    operationId: 'voidSettlement',
    method: 'delete',
    path: '/households/{householdId}/settlements/{settlementId}',
    tag: 'Settlements',
    summary: 'Void a settlement',
    description:
      'Marks the settlement `voided`: it stops counting in balances. Only one of its two parties ' +
      'or a household admin can do it (otherwise 403 `FORBIDDEN`). Not reversible.',
    request: settlementIdParam,
    success: { status: 204, description: 'Settlement voided' },
    errors: { 403: ['FORBIDDEN'], 404: ['NOT_FOUND'], 409: ['SETTLEMENT_ALREADY_VOIDED'] },
  },
];

export const balancesRoutes: RouteSpec[] = [
  {
    operationId: 'getBalances',
    method: 'get',
    path: '/households/{householdId}/balances',
    tag: 'Balances',
    summary: 'Get the net balance per member',
    description:
      'Derived on every call from active expenses and non-voided settlements; never stored. ' +
      '`net` is positive when the member is owed money and negative when they owe; the nets add ' +
      'up to zero. Members who left appear (flagged `isFormerMember`) only while their net is ' +
      'not zero. Incomes and transfers never move balances. Money is in the household currency.',
    request: householdIdOnly,
    success: { status: 200, description: 'Derived balances, never stored', schema: Balances },
  },
  {
    operationId: 'getSimplifiedBalances',
    method: 'get',
    path: '/households/{householdId}/balances/simplified',
    tag: 'Balances',
    summary: 'Get the simplified debt graph',
    description:
      'The smallest set of payments that would settle every balance: each item says who pays ' +
      'whom and how much. Items involving someone who left carry `fromIsFormerMember` or ' +
      '`toIsFormerMember`. Pre-fill `createSettlement` from it.',
    request: householdIdOnly,
    success: {
      status: 200,
      description: 'Minimal set of who-pays-whom transfers',
      schema: SimplifiedBalances,
    },
  },
];

export const incomesRoutes: RouteSpec[] = [
  {
    operationId: 'createIncome',
    method: 'post',
    path: '/households/{householdId}/incomes',
    tag: 'Incomes',
    summary: 'Record an income',
    description:
      'Money received by a member (`receivedBy`, an active member). `amount` is a decimal string ' +
      'with up to 2 decimals, greater than zero, in the household currency; `incomeDate` is a ' +
      'civil date; `categoryId` is optional. Incomes do not move balances; they feed analytics ' +
      'and the activity feed. Requires an `Idempotency-Key`.',
    idempotent: true,
    request: createIncomeSchema,
    success: {
      status: 201,
      description: 'Income recorded (does not move balances)',
      schema: Income,
    },
    errors: { 422: ['INVALID_CURRENCY', 'NOT_A_MEMBER', 'INVALID_CATEGORY'] },
  },
  {
    operationId: 'listIncomes',
    method: 'get',
    path: '/households/{householdId}/incomes',
    tag: 'Incomes',
    summary: 'List incomes',
    description:
      'Newest income date first, cursor-paginated. Voided incomes are hidden unless ' +
      '`includeVoided=true`.',
    request: { params: incomesHouseholdIdParam.params, query: listIncomesQuerySchema },
    success: { status: 200, description: 'Paginated incomes', schema: IncomePage },
  },
  {
    operationId: 'getIncome',
    method: 'get',
    path: '/households/{householdId}/incomes/{incomeId}',
    tag: 'Incomes',
    summary: 'Get income detail',
    description: 'Works for voided incomes too (`voided: true`).',
    request: incomeIdParam,
    success: { status: 200, description: 'Income', schema: Income },
    errors: { 404: ['NOT_FOUND'] },
  },
  {
    operationId: 'updateIncome',
    method: 'patch',
    path: '/households/{householdId}/incomes/{incomeId}',
    tag: 'Incomes',
    summary: 'Update an income',
    description:
      'Partial update of `receivedBy`, `description`, `notes` (nullable), `amount`, `categoryId` ' +
      '(nullable) and `incomeDate`. A voided income cannot be edited.',
    request: updateIncomeSchema,
    success: { status: 200, description: 'Updated income', schema: Income },
    errors: {
      404: ['NOT_FOUND'],
      409: ['INCOME_ALREADY_VOIDED'],
      422: ['NOT_A_MEMBER', 'INVALID_CATEGORY'],
    },
  },
  {
    operationId: 'voidIncome',
    method: 'delete',
    path: '/households/{householdId}/incomes/{incomeId}',
    tag: 'Incomes',
    summary: 'Void an income',
    description: 'Marks the income `voided` (hidden from lists and analytics). Not reversible.',
    request: incomeIdParam,
    success: { status: 204, description: 'Income voided' },
    errors: { 404: ['NOT_FOUND'], 409: ['INCOME_ALREADY_VOIDED'] },
  },
];

export const transfersRoutes: RouteSpec[] = [
  {
    operationId: 'createTransfer',
    method: 'post',
    path: '/households/{householdId}/transfers',
    tag: 'Transfers',
    summary: 'Record a transfer between two members',
    description:
      'Records that `fromUser` moved `amount` to `toUser`. The caller must be one of the two ' +
      'parties (otherwise 403 `FORBIDDEN`); both must be active members and different. Unlike ' +
      'a settlement, a transfer does not move balances. `amount` is a decimal string with up to ' +
      '2 decimals, greater than zero, in the household currency. Requires an `Idempotency-Key`.',
    idempotent: true,
    request: createTransferSchema,
    success: {
      status: 201,
      description: 'Transfer recorded (does not move balances)',
      schema: Transfer,
    },
    errors: { 403: ['FORBIDDEN'], 422: ['INVALID_TRANSFER', 'INVALID_CURRENCY'] },
  },
  {
    operationId: 'listTransfers',
    method: 'get',
    path: '/households/{householdId}/transfers',
    tag: 'Transfers',
    summary: 'List transfers',
    description:
      'Newest transfer date first, cursor-paginated. Voided transfers are hidden unless ' +
      '`includeVoided=true`.',
    request: { params: transfersHouseholdIdParam.params, query: listTransfersQuerySchema },
    success: { status: 200, description: 'Paginated transfers', schema: TransferPage },
  },
  {
    operationId: 'getTransfer',
    method: 'get',
    path: '/households/{householdId}/transfers/{transferId}',
    tag: 'Transfers',
    summary: 'Get transfer detail',
    description: 'Works for voided transfers too (`voided: true`).',
    request: transferIdParam,
    success: { status: 200, description: 'Transfer', schema: Transfer },
    errors: { 404: ['NOT_FOUND'] },
  },
  {
    operationId: 'voidTransfer',
    method: 'delete',
    path: '/households/{householdId}/transfers/{transferId}',
    tag: 'Transfers',
    summary: 'Void a transfer',
    description:
      'Marks the transfer `voided`. Only one of its two parties or a household admin can do it ' +
      '(otherwise 403 `FORBIDDEN`). Not reversible.',
    request: transferIdParam,
    success: { status: 204, description: 'Transfer voided' },
    errors: { 403: ['FORBIDDEN'], 404: ['NOT_FOUND'], 409: ['TRANSFER_ALREADY_VOIDED'] },
  },
];

export const activityRoutes: RouteSpec[] = [
  {
    operationId: 'listActivity',
    method: 'get',
    path: '/households/{householdId}/activity',
    tag: 'Activity',
    summary: 'Get the unified activity feed',
    description:
      'Active expenses, non-voided incomes, transfers and settlements merged newest first ' +
      '(`date` is the business date of each record), cursor-paginated. Pending recurring ' +
      'occurrences are not included. It is a compact feed: use the `id` and `type` to fetch the ' +
      'full record. The `cursor` is opaque, taken from `nextCursor`; a made-up one is 400 ' +
      '`BAD_REQUEST`.',
    request: { params: householdIdOnly.params, query: paginationQuerySchema },
    success: {
      status: 200,
      description: 'Chronological merge of expenses, incomes, transfers and settlements',
      schema: ActivityPage,
    },
    errors: { 400: ['BAD_REQUEST'] },
  },
];

export const analyticsRoutes: RouteSpec[] = [
  {
    operationId: 'getAnalyticsSummary',
    method: 'get',
    path: '/households/{householdId}/analytics/summary',
    tag: 'Analytics',
    summary: 'Get total spent, total income and net for a date range',
    description: `${DATE_RANGE} \`net\` is income minus spending and can be negative.`,
    request: dateRangeSchema,
    success: { status: 200, description: 'Summary for the range', schema: AnalyticsSummary },
  },
  {
    operationId: 'getAnalyticsByCategory',
    method: 'get',
    path: '/households/{householdId}/analytics/by-category',
    tag: 'Analytics',
    summary: 'Get spend by category for a date range',
    description:
      `${DATE_RANGE} Biggest spend first. Expenses without a category are grouped under ` +
      '`categoryId: null`.',
    request: dateRangeSchema,
    success: {
      status: 200,
      description: 'Spend broken down by category',
      schema: CategorySpendList,
    },
  },
  {
    operationId: 'getAnalyticsByMember',
    method: 'get',
    path: '/households/{householdId}/analytics/by-member',
    tag: 'Analytics',
    summary: "Get spend by member's split share for a date range",
    description:
      `${DATE_RANGE} Adds up each member's **share** of the expenses (their split), not what ` +
      'they paid. Biggest first.',
    request: dateRangeSchema,
    success: { status: 200, description: 'Spend broken down by member', schema: MemberSpendList },
  },
  {
    operationId: 'getAnalyticsOverTime',
    method: 'get',
    path: '/households/{householdId}/analytics/over-time',
    tag: 'Analytics',
    summary: 'Get a spend time series for a date range',
    description:
      `${DATE_RANGE} \`granularity\` (default \`day\`) buckets the spending by day, week or ` +
      'month; each point is dated at the first day of its bucket and only buckets with ' +
      'spending are returned (empty ones are omitted), oldest first.',
    request: overTimeSchema,
    success: {
      status: 200,
      description: 'Time series bucketed by day, week or month',
      schema: TimeSeries,
    },
  },
  {
    operationId: 'getAnalyticsComparison',
    method: 'get',
    path: '/households/{householdId}/analytics/comparison',
    tag: 'Analytics',
    summary: 'Compare a date range against the equal-length prior period',
    description: `${DATE_RANGE} \`previous\` covers the same number of days immediately before \`from\`.`,
    request: dateRangeSchema,
    success: {
      status: 200,
      description: 'Current vs. previous period',
      schema: AnalyticsComparison,
    },
  },
];
