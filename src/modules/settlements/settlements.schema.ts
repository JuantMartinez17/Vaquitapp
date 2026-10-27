import { z } from 'zod';
import { idCursorPaginationQuerySchema } from '../../shared/utils/pagination.js';
import { civilDateSchema } from '../../shared/validation/civil-date.schema.js';
import { moneyAmountSchema } from '../../shared/validation/money-amount.schema.js';
import { textSchema } from '../../shared/validation/text.schema.js';

const householdId = z.object({ householdId: z.string().uuid() });
const settlementParam = z.object({
  householdId: z.string().uuid(),
  settlementId: z.string().uuid(),
});

export const householdIdParam = {
  params: householdId,
};

export const settlementIdParam = {
  params: settlementParam,
};

export const createSettlementSchema = {
  params: householdId,
  body: z
    .object({
      fromUser: z.string().uuid(),
      toUser: z.string().uuid(),
      amount: moneyAmountSchema,
      currencyCode: z.string().length(3).toUpperCase(),
      settlementDate: civilDateSchema,
      notes: textSchema(2000, 0).optional(),
    })
    .strict(),
};

export const listSettlementsQuerySchema = idCursorPaginationQuerySchema;

export type CreateSettlementDto = z.infer<typeof createSettlementSchema.body>;
