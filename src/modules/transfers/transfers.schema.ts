import { z } from 'zod';
import { paginationQuerySchema } from '../../shared/utils/pagination.js';

const DECIMAL = /^\d+(\.\d+)?$/;
const CIVIL_DATE = /^\d{4}-\d{2}-\d{2}$/;

const householdId = z.object({ householdId: z.string().uuid() });
const transferParam = z.object({
  householdId: z.string().uuid(),
  transferId: z.string().uuid(),
});

export const householdIdParam = {
  params: householdId,
};

export const transferIdParam = {
  params: transferParam,
};

export const createTransferSchema = {
  params: householdId,
  body: z
    .object({
      fromUser: z.string().uuid(),
      toUser: z.string().uuid(),
      amount: z.string().regex(DECIMAL),
      currencyCode: z.string().length(3).toUpperCase(),
      transferDate: z.string().regex(CIVIL_DATE),
      notes: z.string().max(2000).optional(),
    })
    .strict(),
};

export const listTransfersQuerySchema = paginationQuerySchema;

export type CreateTransferDto = z.infer<typeof createTransferSchema.body>;
