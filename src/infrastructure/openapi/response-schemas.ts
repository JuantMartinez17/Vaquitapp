import { z } from 'zod';
import { ErrorCode } from '../../shared/errors/codes.js';
import type { UserDto } from '../../modules/users/users.mapper.js';
import type { HouseholdDto, MemberDto } from '../../modules/households/households.mapper.js';
import type {
  CreatedInvitationDto,
  InvitationDto,
} from '../../modules/invitations/invitations.mapper.js';
import type { CategoryDto } from '../../modules/categories/categories.mapper.js';
import type { ExpenseDto, ExpenseSplitDto } from '../../modules/expenses/expenses.mapper.js';
import type { SettlementDto } from '../../modules/settlements/settlements.mapper.js';
import type { IncomeDto } from '../../modules/incomes/incomes.mapper.js';
import type { TransferDto } from '../../modules/transfers/transfers.mapper.js';
import type {
  RecurringExpenseDto,
  RecurringExpenseSplitDto,
  UpcomingRecurringExpenseDto,
} from '../../modules/recurring-expenses/recurring-expenses.mapper.js';
import type { AttachmentDto } from '../../modules/attachments/attachments.mapper.js';
import type { ActivityItem } from '../../modules/activity/activity.service.js';

/**
 * Response contract of the API, as Zod schemas.
 *
 * Every object is `strictObject` at every nesting level, so parsing a real
 * response with these schemas fails on a missing AND on an extra field. That
 * is what the contract test relies on to prove the generated OpenAPI document
 * does not lie (see openapi.contract.itest.ts).
 *
 * Schemas registered through `register()` become reusable `components.schemas`
 * entries referenced with `$ref`; the rest are inlined.
 */

export interface SchemaMeta {
  id: string;
}

/** Registry of the schemas that are published as named components. */
export const schemaRegistry = z.registry<SchemaMeta>();
export type SchemaRegistry = typeof schemaRegistry;

const register = <T extends z.ZodType>(id: string, schema: T): T => {
  schemaRegistry.add(schema, { id });
  return schema;
};

const strictObject = <T extends z.ZodRawShape>(shape: T) => z.strictObject(shape);

// ── Scalars ────────────────────────────────────────────────────────────────

export const Uuid = register('Uuid', z.uuid().meta({ description: 'UUID v4 identifier.' }));

/**
 * Responses print a money amount with the currency's own decimals (`"85000.00"`,
 * or `"85000"` for a 0-decimal currency). Balances and net figures can be
 * negative, which the request-side pattern (non-negative) does not allow.
 */
export const Money = register(
  'Money',
  z
    .string()
    .regex(/^-?\d+(\.\d+)?$/)
    .meta({
      description:
        'Decimal amount serialized as a string, with as many decimals as the currency has ' +
        '(for example "85000.00"). Never a JSON number. Net balances can be negative.',
      example: '85000.00',
    }),
);

export const CivilDate = register(
  'CivilDate',
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .meta({
      description: 'Calendar day without time or timezone, formatted YYYY-MM-DD.',
      example: '2026-08-15',
    }),
);

export const Timestamp = register(
  'Timestamp',
  z.iso.datetime().meta({
    description: 'System timestamp, ISO-8601 in UTC with milliseconds.',
    example: '2026-08-15T14:30:00.000Z',
  }),
);

export const CurrencyCode = register(
  'CurrencyCode',
  z
    .string()
    .regex(/^[A-Z]{3}$/)
    .meta({ description: 'ISO 4217 currency code in upper case.', example: 'ARS' }),
);

const RoleEnum = register('MemberRole', z.enum(['admin', 'member']));
const InvitationStatusEnum = register(
  'InvitationStatus',
  z
    .enum(['pending', 'accepted', 'rejected', 'expired'])
    .meta({ description: 'A pending invitation past its deadline is reported as `expired`.' }),
);
const ExpenseStatusEnum = register(
  'ExpenseStatus',
  z.enum(['active', 'voided', 'pending']).meta({
    description:
      '`pending` is a generated recurring occurrence awaiting confirm/skip and does not count ' +
      'toward balances; `voided` rows never count.',
  }),
);
const SplitTypeEnum = register('SplitType', z.enum(['equal', 'exact', 'percentage', 'shares']));
const SettlementStatusEnum = register(
  'SettlementStatus',
  z.enum(['pending', 'confirmed', 'voided']).meta({
    description: 'Settlements are created `confirmed`; voiding sets `voided`.',
  }),
);
const FrequencyEnum = register(
  'RecurrenceFrequency',
  z.enum(['daily', 'weekly', 'monthly', 'yearly']),
);

// ── Shared fragments ───────────────────────────────────────────────────────

/** `{ id, displayName }` reference to a user, used for payer/receiver/parties. */
export const UserRef = register(
  'UserRef',
  strictObject({ id: Uuid, displayName: z.string().nullable() }),
);

export const CategoryRef = register('CategoryRef', strictObject({ id: Uuid, name: z.string() }));

// ── Errors ─────────────────────────────────────────────────────────────────

export const ERROR_CODES = Object.values(ErrorCode) as [ErrorCode, ...ErrorCode[]];

export const ErrorResponse = register(
  'Error',
  strictObject({
    error: strictObject({
      code: z.enum(ERROR_CODES).meta({
        description:
          'Stable machine-readable code. Clients render text from this, never from `message`.',
      }),
      message: z
        .string()
        .meta({ description: 'English text for debugging; not meant for end users.' }),
      details: z
        .unknown()
        .optional()
        .meta({
          description:
            'Extra context. `VALIDATION_ERROR`: map of field name to string[] of problems, plus an ' +
            'optional `formErrors: string[]` for problems with no field path. ' +
            '`MEMBER_HAS_OPEN_BALANCE`: `{ net: Money }`.',
        }),
    }),
  }),
);

// ── Auth & users ───────────────────────────────────────────────────────────

export const User = register(
  'User',
  strictObject({
    id: Uuid,
    email: z.string(),
    username: z.string(),
    displayName: z.string().nullable(),
    avatarUrl: z.string().nullable(),
    preferredCurrencyCode: CurrencyCode,
    emailVerified: z.boolean(),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  }),
);

export const TokenPair = register(
  'TokenPair',
  strictObject({
    accessToken: z.string().meta({ description: 'JWT, valid for 15 minutes.' }),
    refreshToken: z.string().meta({
      description: 'Opaque, single-use token valid for 30 days. Replace it with every refresh.',
    }),
  }),
);

export const AuthSession = register(
  'AuthSession',
  strictObject({
    user: User,
    accessToken: TokenPair.shape.accessToken,
    refreshToken: TokenPair.shape.refreshToken,
  }),
);

// ── Households ─────────────────────────────────────────────────────────────

export const Household = register(
  'Household',
  strictObject({
    id: Uuid,
    name: z.string(),
    description: z.string().nullable(),
    defaultCurrencyCode: CurrencyCode,
    createdBy: Uuid,
    role: RoleEnum.optional().meta({
      description: 'Role of the caller. Present on create, list and get; omitted on update.',
    }),
    memberCount: z.number().int().optional().meta({
      description: 'Active members. Present on create, list, get and update.',
    }),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  }),
);

export const Member = register(
  'Member',
  strictObject({
    userId: Uuid,
    role: RoleEnum,
    joinedAt: Timestamp,
    user: strictObject({
      id: Uuid,
      username: z.string(),
      displayName: z.string().nullable(),
      avatarUrl: z.string().nullable(),
      email: z.string(),
    }),
  }),
);

export const Invitation = register(
  'Invitation',
  strictObject({
    id: Uuid,
    householdId: Uuid,
    invitedEmail: z.string(),
    status: InvitationStatusEnum,
    expiresAt: Timestamp,
    createdAt: Timestamp,
    respondedAt: Timestamp.nullable(),
  }),
);

export const CreatedInvitation = register(
  'CreatedInvitation',
  strictObject({
    ...Invitation.shape,
    token: z.string().meta({
      description: 'Secret of the invite link (128 characters). Only ever returned at creation.',
    }),
  }),
);

// ── Catalogs ───────────────────────────────────────────────────────────────

export const Category = register(
  'Category',
  strictObject({
    id: Uuid,
    householdId: Uuid.nullable(),
    name: z.string(),
    icon: z.string().nullable(),
    color: z.string().nullable().meta({ description: 'Hex color such as "#FFAA00".' }),
    isSystem: z.boolean(),
  }),
);

export const Currency = register(
  'Currency',
  strictObject({
    code: CurrencyCode,
    name: z.string(),
    symbol: z.string(),
    decimalPlaces: z.number().int().meta({
      description: 'Decimals used when printing money in this currency (2 for ARS/USD, 0 for CLP).',
    }),
  }),
);

// ── Expenses ───────────────────────────────────────────────────────────────

export const ExpenseSplit = register(
  'ExpenseSplit',
  strictObject({
    userId: Uuid,
    displayName: z.string().nullable(),
    amount: Money,
    percentage: z
      .string()
      .regex(/^\d+(\.\d+)?$/)
      .nullable()
      .meta({
        description: 'Only for `percentage` splits, as a decimal string ("33.33" or "50").',
      }),
    shares: z.number().int().nullable().meta({ description: 'Only for `shares` splits.' }),
  }),
);

export const Expense = register(
  'Expense',
  strictObject({
    id: Uuid,
    householdId: Uuid,
    description: z.string(),
    notes: z.string().nullable(),
    amount: Money,
    currencyCode: CurrencyCode,
    expenseDate: CivilDate,
    status: ExpenseStatusEnum,
    splitType: SplitTypeEnum,
    paidBy: UserRef,
    category: CategoryRef.nullable(),
    splits: z.array(ExpenseSplit),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  }),
);

// ── Settlements, incomes, transfers ────────────────────────────────────────

export const Settlement = register(
  'Settlement',
  strictObject({
    id: Uuid,
    householdId: Uuid,
    from: UserRef,
    to: UserRef,
    amount: Money,
    currencyCode: CurrencyCode,
    settlementDate: CivilDate,
    notes: z.string().nullable(),
    status: SettlementStatusEnum,
    createdAt: Timestamp,
  }),
);

export const Income = register(
  'Income',
  strictObject({
    id: Uuid,
    householdId: Uuid,
    receivedBy: UserRef,
    description: z.string(),
    notes: z.string().nullable(),
    amount: Money,
    currencyCode: CurrencyCode,
    category: CategoryRef.nullable(),
    incomeDate: CivilDate,
    voided: z.boolean(),
    createdAt: Timestamp,
  }),
);

export const Transfer = register(
  'Transfer',
  strictObject({
    id: Uuid,
    householdId: Uuid,
    from: UserRef,
    to: UserRef,
    amount: Money,
    currencyCode: CurrencyCode,
    transferDate: CivilDate,
    notes: z.string().nullable(),
    voided: z.boolean(),
    createdAt: Timestamp,
  }),
);

// ── Balances & activity ────────────────────────────────────────────────────

export const MemberBalance = register(
  'MemberBalance',
  strictObject({
    userId: Uuid,
    displayName: z.string().nullable(),
    net: Money,
    isFormerMember: z.boolean().meta({
      description:
        'True for someone who left the household. Former members only appear while their net ' +
        'is not zero.',
    }),
  }),
);

export const Balances = register(
  'Balances',
  strictObject({
    currencyCode: CurrencyCode,
    balances: z.array(MemberBalance).meta({
      description: 'Sorted by userId. The nets of all rows add up to zero.',
    }),
  }),
);

export const SimplifiedTransfer = register(
  'SimplifiedTransfer',
  strictObject({
    from: Uuid,
    fromDisplayName: z.string().nullable(),
    fromIsFormerMember: z.boolean(),
    to: Uuid,
    toDisplayName: z.string().nullable(),
    toIsFormerMember: z.boolean(),
    amount: Money,
  }),
);

export const SimplifiedBalances = register(
  'SimplifiedBalances',
  strictObject({
    currencyCode: CurrencyCode,
    simplified: z.array(SimplifiedTransfer).meta({
      description: 'Minimal set of payments that would settle every balance.',
    }),
  }),
);

export const ActivityItemSchema = register(
  'ActivityItem',
  strictObject({
    id: Uuid,
    type: z.enum(['expense', 'income', 'transfer', 'settlement']),
    date: CivilDate,
    amount: Money,
    description: z.string().meta({
      description:
        'Expense/income description, or "Payer → Receiver" for transfers and settlements.',
    }),
  }),
);

// ── Recurring expenses ─────────────────────────────────────────────────────

export const RecurringExpenseSplit = register(
  'RecurringExpenseSplit',
  strictObject({
    userId: Uuid,
    displayName: z.string().nullable(),
    amount: Money.nullable(),
    percentage: z
      .string()
      .regex(/^\d+(\.\d+)?$/)
      .nullable(),
    shares: z.number().int().nullable(),
  }),
);

export const RecurringExpense = register(
  'RecurringExpense',
  strictObject({
    id: Uuid,
    householdId: Uuid,
    description: z.string(),
    defaultAmount: Money,
    currencyCode: CurrencyCode,
    category: CategoryRef.nullable(),
    paidBy: UserRef,
    splitType: SplitTypeEnum,
    splits: z.array(RecurringExpenseSplit),
    frequency: FrequencyEnum,
    dayOfMonth: z.number().int().nullable(),
    startDate: CivilDate,
    endDate: CivilDate.nullable(),
    isActive: z.boolean(),
    nextRunDate: CivilDate,
    lastGeneratedDate: CivilDate.nullable(),
  }),
);

export const UpcomingRecurringExpense = register(
  'UpcomingRecurringExpense',
  strictObject({
    id: Uuid,
    description: z.string(),
    defaultAmount: Money,
    currencyCode: CurrencyCode,
    nextRunDate: CivilDate,
    overdue: z.boolean().meta({ description: 'True when `nextRunDate` is today or earlier.' }),
  }),
);

// ── Attachments ────────────────────────────────────────────────────────────

export const Attachment = register(
  'Attachment',
  strictObject({
    id: Uuid,
    expenseId: Uuid,
    originalFilename: z.string(),
    mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']).meta({
      description: 'Detected from the file content, not from the declared Content-Type.',
    }),
    sizeBytes: z
      .string()
      .regex(/^\d+$/)
      .meta({ description: 'Size in bytes, as a decimal string.' }),
    uploadedBy: Uuid,
    uploadedAt: Timestamp,
  }),
);

export const AttachmentDownload = register(
  'AttachmentDownload',
  strictObject({
    url: z.string().meta({
      description:
        'Short-lived presigned URL. Absolute with S3 storage; a path relative to the server ' +
        '(`/api/v1/files/local/...`) when the server uses local development storage.',
    }),
    expiresInSeconds: z.number().int().meta({ example: 300 }),
  }),
);

// ── Analytics ──────────────────────────────────────────────────────────────

export const AnalyticsSummary = register(
  'AnalyticsSummary',
  strictObject({
    currencyCode: CurrencyCode,
    from: CivilDate,
    to: CivilDate,
    totalSpent: Money,
    totalIncome: Money,
    net: Money,
  }),
);

export const CategorySpend = register(
  'CategorySpend',
  strictObject({
    categoryId: Uuid.nullable(),
    categoryName: z.string(),
    totalSpent: Money,
  }),
);

export const MemberSpend = register(
  'MemberSpend',
  strictObject({ userId: Uuid, displayName: z.string().nullable(), totalSpent: Money }),
);

export const TimeSeriesPoint = register(
  'TimeSeriesPoint',
  strictObject({
    date: CivilDate,
    totalSpent: Money,
  }),
);

export const AnalyticsComparison = register(
  'AnalyticsComparison',
  strictObject({
    current: AnalyticsSummary,
    previous: AnalyticsSummary,
  }),
);

// ── Health ─────────────────────────────────────────────────────────────────

export const HealthLive = register(
  'HealthLive',
  strictObject({ status: z.literal('ok'), timestamp: Timestamp }),
);

export const HealthReady = register(
  'HealthReady',
  strictObject({ status: z.literal('ready'), database: z.literal('connected') }),
);

export const HealthNotReady = register(
  'HealthNotReady',
  strictObject({ status: z.literal('not ready'), database: z.literal('disconnected') }),
);

// ── Collections ────────────────────────────────────────────────────────────

/** Cursor-paginated envelope. */
const page = <T extends z.ZodType>(id: string, item: T) =>
  register(
    id,
    strictObject({
      data: z.array(item),
      nextCursor: z.string().nullable().meta({
        description: 'Pass it as `cursor` to get the next page. Null on the last page.',
      }),
    }),
  );

export const ExpensePage = page('ExpensePage', Expense);
export const SettlementPage = page('SettlementPage', Settlement);
export const IncomePage = page('IncomePage', Income);
export const TransferPage = page('TransferPage', Transfer);
export const ActivityPage = page('ActivityPage', ActivityItemSchema);

/** Bounded lists are bare arrays; registered so every operation references a named schema. */
const list = <T extends z.ZodType>(id: string, item: T) => register(id, z.array(item));

export const InvitationList = list('InvitationList', Invitation);
export const HouseholdList = list('HouseholdList', Household);
export const MemberList = list('MemberList', Member);
export const CategoryList = list('CategoryList', Category);
export const CurrencyList = list('CurrencyList', Currency);
export const RecurringExpenseList = list('RecurringExpenseList', RecurringExpense);
export const UpcomingRecurringExpenseList = list(
  'UpcomingRecurringExpenseList',
  UpcomingRecurringExpense,
);
export const AttachmentList = list('AttachmentList', Attachment);
export const CategorySpendList = list('CategorySpendList', CategorySpend);
export const MemberSpendList = list('MemberSpendList', MemberSpend);
export const TimeSeries = list('TimeSeries', TimeSeriesPoint);

// ── Compile-time link to the mappers ───────────────────────────────────────
// A mapper that gains, loses or retypes a field stops this file compiling, so
// the contract cannot silently fall behind the code that produces responses.

type Assert<_T extends true> = never;
type Assignable<A, B> = [A] extends [B] ? true : false;
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

export type MapperContractChecks = [
  Assert<Same<z.infer<typeof User>, UserDto>>,
  Assert<Same<z.infer<typeof Household>, HouseholdDto>>,
  Assert<Same<z.infer<typeof Member>, MemberDto>>,
  Assert<Same<z.infer<typeof Invitation>, InvitationDto>>,
  Assert<Same<z.infer<typeof CreatedInvitation>, CreatedInvitationDto>>,
  Assert<Same<z.infer<typeof Category>, CategoryDto>>,
  Assert<Same<z.infer<typeof ExpenseSplit>, ExpenseSplitDto>>,
  Assert<Same<z.infer<typeof Expense>, ExpenseDto>>,
  Assert<Same<z.infer<typeof Settlement>, SettlementDto>>,
  Assert<Same<z.infer<typeof Income>, IncomeDto>>,
  Assert<Same<z.infer<typeof Transfer>, TransferDto>>,
  Assert<Same<z.infer<typeof RecurringExpenseSplit>, RecurringExpenseSplitDto>>,
  Assert<Same<z.infer<typeof RecurringExpense>, RecurringExpenseDto>>,
  Assert<Same<z.infer<typeof UpcomingRecurringExpense>, UpcomingRecurringExpenseDto>>,
  Assert<Assignable<z.infer<typeof Attachment>, AttachmentDto>>,
  Assert<Same<z.infer<typeof ActivityItemSchema>, ActivityItem>>,
];
