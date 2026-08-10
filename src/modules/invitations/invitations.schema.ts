import { z } from 'zod';

const householdId = z.object({ householdId: z.string().uuid() });
const invitationParam = z.object({
  householdId: z.string().uuid(),
  invitationId: z.string().uuid(),
});
const tokenParam = z.object({ token: z.string().min(1) });

export const householdIdParam = {
  params: householdId,
};

export const createInvitationSchema = {
  params: householdId,
  body: z.object({ invitedEmail: z.string().email().toLowerCase() }).strict(),
};

export const invitationIdParam = {
  params: invitationParam,
};

export const tokenSchema = {
  params: tokenParam,
};

export type CreateInvitationDto = z.infer<typeof createInvitationSchema.body>;
