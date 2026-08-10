import { z } from 'zod';
import { paginationQuerySchema } from '../../shared/utils/pagination.js';

const DECIMAL = /^\d+(\.\d+)?$/;
const CIVIL_DATE = /^\d{4}-\d{2}-\d{2}$/;

const householdId = z.object({ householdId: z.string().uuid() });
const expenseParam = z.object({
  householdId: z.string().uuid(),
  expenseId: z.string().uuid(),
});

const participantSchema = z
  .object({
    userId: z.string().uuid(),
    amount: z.string().regex(DECIMAL).optional(),
    percentage: z.coerce.number().min(0).max(100).optional(),
    shares: z.number().int().positive().optional(),
  })
  .strict();

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
      description: z.string().min(1).max(255),
      notes: z.string().max(2000).optional(),
      amount: z.string().regex(DECIMAL),
      currencyCode: z.string().length(3).toUpperCase(),
      expenseDate: z.string().regex(CIVIL_DATE),
      categoryId: z.string().uuid().optional(),
      paidBy: z.string().uuid(),
      splitType: splitTypeEnum,
      participants: z.array(participantSchema).min(1),
    })
    .strict(),
};

// Metadata can be patched independently, but the split (amount/splitType/
// participants) is recalculated from scratch — see void-expense.md — so
// those three fields must be provided together, never individually.
const splitFields = z.object({
  amount: z.string().regex(DECIMAL),
  splitType: splitTypeEnum,
  participants: z.array(participantSchema).min(1),
});

export const updateExpenseSchema = {
  params: expenseParam,
  body: z
    .object({
      description: z.string().min(1).max(255),
      notes: z.string().max(2000).nullable(),
      expenseDate: z.string().regex(CIVIL_DATE),
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

export const listExpensesQuerySchema = paginationQuerySchema.extend({
  from: z.string().regex(CIVIL_DATE).optional(),
  to: z.string().regex(CIVIL_DATE).optional(),
  categoryId: z.string().uuid().optional(),
  paidBy: z.string().uuid().optional(),
  participantId: z.string().uuid().optional(),
  status: z.enum(['active', 'voided', 'pending']).optional(),
});

export type CreateExpenseDto = z.infer<typeof createExpenseSchema.body>;
export type UpdateExpenseDto = z.infer<typeof updateExpenseSchema.body>;
export type ParticipantInput = z.infer<typeof participantSchema>;
export type ListExpensesQuery = z.infer<typeof listExpensesQuerySchema>;
