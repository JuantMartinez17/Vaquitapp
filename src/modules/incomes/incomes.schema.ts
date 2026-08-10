import { z } from 'zod';
import { paginationQuerySchema } from '../../shared/utils/pagination.js';

const DECIMAL = /^\d+(\.\d+)?$/;
const CIVIL_DATE = /^\d{4}-\d{2}-\d{2}$/;

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
      description: z.string().min(1).max(255),
      notes: z.string().max(2000).optional(),
      amount: z.string().regex(DECIMAL),
      currencyCode: z.string().length(3).toUpperCase(),
      categoryId: z.string().uuid().optional(),
      incomeDate: z.string().regex(CIVIL_DATE),
    })
    .strict(),
};

export const updateIncomeSchema = {
  params: incomeParam,
  body: z
    .object({
      receivedBy: z.string().uuid(),
      description: z.string().min(1).max(255),
      notes: z.string().max(2000).nullable(),
      amount: z.string().regex(DECIMAL),
      categoryId: z.string().uuid().nullable(),
      incomeDate: z.string().regex(CIVIL_DATE),
    })
    .partial()
    .strict(),
};

export const listIncomesQuerySchema = paginationQuerySchema;

export type CreateIncomeDto = z.infer<typeof createIncomeSchema.body>;
export type UpdateIncomeDto = z.infer<typeof updateIncomeSchema.body>;
