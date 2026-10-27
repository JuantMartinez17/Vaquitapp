import { z } from 'zod';

const householdId = z.object({ householdId: z.string().uuid() });
const invitationParam = z.object({
  householdId: z.string().uuid(),
  invitationId: z.string().uuid(),
});
// Tokens are 128 characters (see invitations.service); a longer value can never match.
const tokenParam = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/) });

export const householdIdParam = {
  params: householdId,
};

export const createInvitationSchema = {
  params: householdId,
  body: z.object({ invitedEmail: z.string().email().max(255).toLowerCase() }).strict(),
};

export const invitationIdParam = {
  params: invitationParam,
};

export const tokenSchema = {
  params: tokenParam,
};

export type CreateInvitationDto = z.infer<typeof createInvitationSchema.body>;
