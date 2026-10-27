import { z } from 'zod';
import { idCursorPaginationQuerySchema } from '../../shared/utils/pagination.js';
import { civilDateSchema } from '../../shared/validation/civil-date.schema.js';
import { includeVoidedSchema } from '../../shared/validation/include-voided.schema.js';
import { moneyAmountSchema } from '../../shared/validation/money-amount.schema.js';
import { textSchema } from '../../shared/validation/text.schema.js';

/** Upper bound on the people one expense is split across; keeps the write fan-out small. */
export const MAX_PARTICIPANTS = 50;
/** `shares` is an int4 column. The cap is far above any real split ("2 shares vs 1"). */
const MAX_SHARES = 1_000_000;

const householdId = z.object({ householdId: z.string().uuid() });
const expenseParam = z.object({
  householdId: z.string().uuid(),
  expenseId: z.string().uuid(),
});

const participantSchema = z
  .object({
    userId: z.string().uuid(),
    amount: moneyAmountSchema.optional(),
    percentage: z.coerce.number().min(0).max(100).optional(),
    shares: z.number().int().positive().max(MAX_SHARES).optional(),
  })
  .strict();

// A repeated user would only fail later on the (expense, user) unique index.
export const participantsSchema = z
  .array(participantSchema)
  .min(1)
  .max(MAX_PARTICIPANTS)
  .refine(
    (participants) => new Set(participants.map((p) => p.userId)).size === participants.length,
    {
      message: 'Each participant can only appear once',
    },
  );

const splitTypeEnum = z.enum(['equal', 'exact', 'percentage', 'shares']);

export const householdIdParam = {
  params: householdId,
};

export const expenseIdParam = {
  params: expenseParam,
};

export const createExpenseSchema = {
  params: householdId,
  body: z
    .object({
      description: textSchema(255),
      notes: textSchema(2000, 0).optional(),
      amount: moneyAmountSchema,
      currencyCode: z.string().length(3).toUpperCase(),
      expenseDate: civilDateSchema,
      categoryId: z.string().uuid().optional(),
      paidBy: z.string().uuid(),
      splitType: splitTypeEnum,
      participants: participantsSchema,
    })
    .strict(),
};

// Metadata can be patched independently, but the split (amount/splitType/
// participants) is recalculated from scratch — see void-expense.md — so
// those three fields must be provided together, never individually.
const splitFields = z.object({
  amount: moneyAmountSchema,
  splitType: splitTypeEnum,
  participants: participantsSchema,
});

export const updateExpenseSchema = {
  params: expenseParam,
  body: z
    .object({
      description: textSchema(255),
      notes: textSchema(2000, 0).nullable(),
      expenseDate: civilDateSchema,
      categoryId: z.string().uuid().nullable(),
      paidBy: z.string().uuid(),
    })
    .partial()
    .merge(splitFields.partial())
    .strict()
    .refine(
      (data) => {
        const touched = [data.amount, data.splitType, data.participants].filter(
          (v) => v !== undefined,
        );
        return touched.length === 0 || touched.length === 3;
      },
      { message: 'amount, splitType and participants must be provided together' },
    ),
};

export const listExpensesQuerySchema = idCursorPaginationQuerySchema.extend({
  from: civilDateSchema.optional(),
  to: civilDateSchema.optional(),
  categoryId: z.string().uuid().optional(),
  paidBy: z.string().uuid().optional(),
  participantId: z.string().uuid().optional(),
  status: z.enum(['active', 'voided', 'pending']).optional(),
  // Ignored when `status` is given: that already names the exact set wanted.
  includeVoided: includeVoidedSchema,
});

export type CreateExpenseDto = z.infer<typeof createExpenseSchema.body>;
export type UpdateExpenseDto = z.infer<typeof updateExpenseSchema.body>;
export type ParticipantInput = z.infer<typeof participantSchema>;
export type ListExpensesQuery = z.infer<typeof listExpensesQuerySchema>;
