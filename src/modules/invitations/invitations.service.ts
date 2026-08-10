import { randomBytes } from 'node:crypto';
import { prisma } from '../../infrastructure/database/prisma.js';
import { ConflictError, ForbiddenError, NotFoundError } from '../../shared/errors/errors.js';
import { ErrorCode } from '../../shared/errors/codes.js';
import { toCreatedInvitationDto, toInvitationDto } from './invitations.mapper.js';
import type { CreatedInvitationDto, InvitationDto } from './invitations.mapper.js';
import { toMemberDto } from '../households/households.mapper.js';
import type { MemberDto } from '../households/households.mapper.js';

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const TOKEN_BYTES = 96; // base64url-encodes to exactly 128 characters (SPECS D2).

const isUniqueConstraintViolation = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';

export const createInvitation = async (
  householdId: string,
  invitedBy: string,
  invitedEmail: string,
): Promise<CreatedInvitationDto> => {
  const invitedUser = await prisma.user.findFirst({
    where: { email: invitedEmail, deletedAt: null },
  });

  try {
    const invitation = await prisma.invitation.create({
      data: {
        householdId,
        invitedBy,
        invitedEmail,
        invitedUserId: invitedUser?.id ?? null,
        token: randomBytes(TOKEN_BYTES).toString('base64url'),
        expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
      },
    });
    return toCreatedInvitationDto(invitation);
  } catch (error) {
    // The one-pending-per-(household,email) rule is enforced by a partial
    // unique index (see migrations/20260809231500_invitations_pending_unique) —
    // there is no equivalent constraint in schema.prisma to check beforehand.
    if (isUniqueConstraintViolation(error)) {
      throw new ConflictError(
        'There is already a pending invitation for this email',
        ErrorCode.INVITATION_ALREADY_PENDING,
      );
    }
    throw error;
  }
};

export const listInvitations = async (householdId: string): Promise<InvitationDto[]> => {
  const invitations = await prisma.invitation.findMany({
    where: { householdId },
    orderBy: { createdAt: 'desc' },
  });
  return invitations.map(toInvitationDto);
};

export const listMyInvitations = async (email: string): Promise<InvitationDto[]> => {
  const invitations = await prisma.invitation.findMany({
    where: { invitedEmail: email, status: 'pending', expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  });
  return invitations.map(toInvitationDto);
};

export const revokeInvitation = async (
  householdId: string,
  invitationId: string,
): Promise<void> => {
  const invitation = await prisma.invitation.findFirst({
    where: { id: invitationId, householdId },
  });
  if (!invitation) {
    throw new NotFoundError('Invitation not found', ErrorCode.INVITATION_NOT_FOUND);
  }
  if (invitation.status !== 'pending') {
    throw new ConflictError(
      'Only a pending invitation can be revoked',
      ErrorCode.INVITATION_ALREADY_RESOLVED,
    );
  }
  // Not a financial fact, so there's no history requirement — revoking a
  // pending invite just removes it, freeing the email up for a new one.
  await prisma.invitation.delete({ where: { id: invitationId } });
};

const loadResolvableInvitation = async (token: string, email: string) => {
  const invitation = await prisma.invitation.findUnique({ where: { token } });
  if (!invitation) {
    throw new NotFoundError('Invitation not found', ErrorCode.INVITATION_NOT_FOUND);
  }
  if (invitation.invitedEmail.toLowerCase() !== email.toLowerCase()) {
    throw new ForbiddenError('This invitation was not sent to you');
  }
  if (invitation.expiresAt < new Date()) {
    throw new ConflictError('This invitation has expired', ErrorCode.INVITATION_EXPIRED);
  }
  if (invitation.status !== 'pending') {
    throw new ConflictError(
      'This invitation was already resolved',
      ErrorCode.INVITATION_ALREADY_RESOLVED,
    );
  }
  return invitation;
};

export const acceptInvitation = async (
  token: string,
  user: { id: string; email: string },
): Promise<MemberDto> => {
  const invitation = await loadResolvableInvitation(token, user.email);

  return prisma.$transaction(async (tx) => {
    const existing = await tx.householdMember.findUnique({
      where: { householdId_userId: { householdId: invitation.householdId, userId: user.id } },
    });

    if (existing && !existing.leftAt) {
      throw new ConflictError(
        'You are already a member of this household',
        ErrorCode.ALREADY_MEMBER,
      );
    }

    let member;
    try {
      // Reactivate a member who previously left instead of creating a
      // duplicate row; the unique (householdId, userId) constraint is the
      // real race guard if two accepts land concurrently (SPECS §24).
      member = existing
        ? await tx.householdMember.update({
            where: { id: existing.id },
            data: { leftAt: null, role: 'member', joinedAt: new Date() },
            include: { user: true },
          })
        : await tx.householdMember.create({
            data: { householdId: invitation.householdId, userId: user.id, role: 'member' },
            include: { user: true },
          });
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        throw new ConflictError(
          'You are already a member of this household',
          ErrorCode.ALREADY_MEMBER,
        );
      }
      throw error;
    }

    const resolved = await tx.invitation.updateMany({
      where: { id: invitation.id, status: 'pending' },
      data: { status: 'accepted', respondedAt: new Date() },
    });
    if (resolved.count === 0) {
      throw new ConflictError(
        'This invitation was already resolved',
        ErrorCode.INVITATION_ALREADY_RESOLVED,
      );
    }

    return toMemberDto(member);
  });
};

export const rejectInvitation = async (
  token: string,
  user: { id: string; email: string },
): Promise<void> => {
  const invitation = await loadResolvableInvitation(token, user.email);

  const resolved = await prisma.invitation.updateMany({
    where: { id: invitation.id, status: 'pending' },
    data: { status: 'rejected', respondedAt: new Date() },
  });
  if (resolved.count === 0) {
    throw new ConflictError(
      'This invitation was already resolved',
      ErrorCode.INVITATION_ALREADY_RESOLVED,
    );
  }
};
