import { z } from 'zod';
import { idCursorPaginationQuerySchema } from '../../shared/utils/pagination.js';
import { civilDateSchema } from '../../shared/validation/civil-date.schema.js';
import { moneyAmountSchema } from '../../shared/validation/money-amount.schema.js';
import { textSchema } from '../../shared/validation/text.schema.js';

const householdId = z.object({ householdId: z.string().uuid() });
const incomeParam = z.object({
  householdId: z.string().uuid(),
  incomeId: z.string().uuid(),
});

export const householdIdParam = {
  params: householdId,
};

export const incomeIdParam = {
  params: incomeParam,
};

export const createIncomeSchema = {
  params: householdId,
  body: z
    .object({
      receivedBy: z.string().uuid(),
      description: textSchema(255),
      notes: textSchema(2000, 0).optional(),
      amount: moneyAmountSchema,
      currencyCode: z.string().length(3).toUpperCase(),
      categoryId: z.string().uuid().optional(),
      incomeDate: civilDateSchema,
    })
    .strict(),
};

export const updateIncomeSchema = {
  params: incomeParam,
  body: z
    .object({
      receivedBy: z.string().uuid(),
      description: textSchema(255),
      notes: textSchema(2000, 0).nullable(),
      amount: moneyAmountSchema,
      categoryId: z.string().uuid().nullable(),
      incomeDate: civilDateSchema,
    })
    .partial()
    .strict(),
};

export const listIncomesQuerySchema = idCursorPaginationQuerySchema;

export type CreateIncomeDto = z.infer<typeof createIncomeSchema.body>;
export type UpdateIncomeDto = z.infer<typeof updateIncomeSchema.body>;
