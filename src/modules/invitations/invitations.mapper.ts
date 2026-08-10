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

export const toInvitationDto = (invitation: Invitation): InvitationDto => ({
  id: invitation.id,
  householdId: invitation.householdId,
  invitedEmail: invitation.invitedEmail,
  status: invitation.status,
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
