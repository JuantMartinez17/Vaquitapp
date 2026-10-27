import { z } from 'zod';
import { idCursorPaginationQuerySchema } from '../../shared/utils/pagination.js';
import { civilDateSchema } from '../../shared/validation/civil-date.schema.js';
import { moneyAmountSchema } from '../../shared/validation/money-amount.schema.js';
import { textSchema } from '../../shared/validation/text.schema.js';

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
      amount: moneyAmountSchema,
      currencyCode: z.string().length(3).toUpperCase(),
      transferDate: civilDateSchema,
      notes: textSchema(2000, 0).optional(),
    })
    .strict(),
};

export const listTransfersQuerySchema = idCursorPaginationQuerySchema;

export type CreateTransferDto = z.infer<typeof createTransferSchema.body>;
