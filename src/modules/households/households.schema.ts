import { z } from 'zod';

const householdId = z.object({ householdId: z.string().uuid() });
const householdAndMember = z.object({
  householdId: z.string().uuid(),
  userId: z.string().uuid(),
});
const role = z.enum(['admin', 'member']);

// Direct add-by-email was replaced by the invitation flow (see
// modules/invitations) — new members always go through an accepted invite.

export const createHouseholdSchema = {
  body: z
    .object({
      name: z.string().min(1).max(100),
      description: z.string().max(2000).optional(),
      defaultCurrencyCode: z.string().length(3).toUpperCase().optional(),
    })
    .strict(),
};

export const householdIdParam = {
  params: householdId,
};

export const updateHouseholdSchema = {
  params: householdId,
  body: z
    .object({
      name: z.string().min(1).max(100),
      description: z.string().max(2000).nullable(),
      defaultCurrencyCode: z.string().length(3).toUpperCase(),
    })
    .partial()
    .strict(),
};

export const memberParam = {
  params: householdAndMember,
};

export const updateMemberRoleSchema = {
  params: householdAndMember,
  body: z.object({ role }).strict(),
};

export type CreateHouseholdDto = z.infer<typeof createHouseholdSchema.body>;
export type UpdateHouseholdDto = z.infer<typeof updateHouseholdSchema.body>;
