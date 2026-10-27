import type { Invitation } from '../../generated/prisma/client.js';

export interface InvitationDto {
  id: string;
  householdId: string;
  invitedEmail: string;
  status: Invitation['status'];
  expiresAt: string;
  createdAt: string;
  respondedAt: string | null;
}

/**
 * A pending invitation past its deadline is reported as 'expired' even if no
 * write has closed it out yet (that only happens when the same email is invited
 * again), so lists never show a dead invitation as actionable.
 */
const effectiveStatus = (invitation: Invitation, now: Date): Invitation['status'] =>
  invitation.status === 'pending' && invitation.expiresAt <= now ? 'expired' : invitation.status;

export const toInvitationDto = (invitation: Invitation, now = new Date()): InvitationDto => ({
  id: invitation.id,
  householdId: invitation.householdId,
  invitedEmail: invitation.invitedEmail,
  status: effectiveStatus(invitation, now),
  expiresAt: invitation.expiresAt.toISOString(),
  createdAt: invitation.createdAt.toISOString(),
  respondedAt: invitation.respondedAt?.toISOString() ?? null,
});

/**
 * The raw token is only ever exposed at creation time — it's the invite
 * link's secret and is never included in a listing response.
 */
export interface CreatedInvitationDto extends InvitationDto {
  token: string;
}

export const toCreatedInvitationDto = (invitation: Invitation): CreatedInvitationDto => ({
  ...toInvitationDto(invitation),
  token: invitation.token,
});
