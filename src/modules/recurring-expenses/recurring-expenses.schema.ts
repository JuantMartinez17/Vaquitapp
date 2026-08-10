import { z } from 'zod';

const DECIMAL = /^\d+(\.\d+)?$/;
const CIVIL_DATE = /^\d{4}-\d{2}-\d{2}$/;

const householdId = z.object({ householdId: z.string().uuid() });
const recurringExpenseParam = z.object({
  householdId: z.string().uuid(),
  recurringExpenseId: z.string().uuid(),
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
const frequencyEnum = z.enum(['daily', 'weekly', 'monthly', 'yearly']);

export const householdIdParam = {
  params: householdId,
};

export const recurringExpenseIdParam = {
  params: recurringExpenseParam,
};

export const createRecurringExpenseSchema = {
  params: householdId,
  body: z
    .object({
      description: z.string().min(1).max(255),
      defaultAmount: z.string().regex(DECIMAL),
      currencyCode: z.string().length(3).toUpperCase(),
      categoryId: z.string().uuid().optional(),
      paidBy: z.string().uuid(),
      splitType: splitTypeEnum,
      participants: z.array(participantSchema).min(1),
      frequency: frequencyEnum,
      dayOfMonth: z.number().int().min(1).max(31).optional(),
      startDate: z.string().regex(CIVIL_DATE),
      endDate: z.string().regex(CIVIL_DATE).optional(),
    })
    .strict(),
};

export const updateRecurringExpenseSchema = {
  params: recurringExpenseParam,
  body: z
    .object({
      description: z.string().min(1).max(255),
      categoryId: z.string().uuid().nullable(),
      paidBy: z.string().uuid(),
      endDate: z.string().regex(CIVIL_DATE).nullable(),
      isActive: z.boolean(),
    })
    .partial()
    .strict(),
};

export type CreateRecurringExpenseDto = z.infer<typeof createRecurringExpenseSchema.body>;
export type UpdateRecurringExpenseDto = z.infer<typeof updateRecurringExpenseSchema.body>;
