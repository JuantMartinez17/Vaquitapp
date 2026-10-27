import { z } from 'zod';
import { civilDateSchema } from '../../shared/validation/civil-date.schema.js';
import { moneyAmountSchema } from '../../shared/validation/money-amount.schema.js';
import { textSchema } from '../../shared/validation/text.schema.js';
import { participantsSchema } from '../expenses/expenses.schema.js';

const householdId = z.object({ householdId: z.string().uuid() });
const recurringExpenseParam = z.object({
  householdId: z.string().uuid(),
  recurringExpenseId: z.string().uuid(),
});

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
      description: textSchema(255),
      defaultAmount: moneyAmountSchema,
      currencyCode: z.string().length(3).toUpperCase(),
      categoryId: z.string().uuid().optional(),
      paidBy: z.string().uuid(),
      splitType: splitTypeEnum,
      participants: participantsSchema,
      frequency: frequencyEnum,
      dayOfMonth: z.number().int().min(1).max(31).optional(),
      startDate: civilDateSchema,
      endDate: civilDateSchema.optional(),
    })
    .strict(),
};

export const updateRecurringExpenseSchema = {
  params: recurringExpenseParam,
  body: z
    .object({
      description: textSchema(255),
      categoryId: z.string().uuid().nullable(),
      paidBy: z.string().uuid(),
      endDate: civilDateSchema.nullable(),
      isActive: z.boolean(),
    })
    .partial()
    .strict(),
};

export type CreateRecurringExpenseDto = z.infer<typeof createRecurringExpenseSchema.body>;
export type UpdateRecurringExpenseDto = z.infer<typeof updateRecurringExpenseSchema.body>;
