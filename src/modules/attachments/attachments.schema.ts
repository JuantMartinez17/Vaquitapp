import { z } from 'zod';

const expenseParam = z.object({
  householdId: z.string().uuid(),
  expenseId: z.string().uuid(),
});

const attachmentParam = expenseParam.extend({
  attachmentId: z.string().uuid(),
});

export const expenseIdParam = {
  params: expenseParam,
};

export const attachmentIdParam = {
  params: attachmentParam,
};
