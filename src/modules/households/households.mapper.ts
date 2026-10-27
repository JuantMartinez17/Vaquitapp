import type { Household, HouseholdMember, Prisma } from '../../generated/prisma/client.js';

export interface HouseholdDto {
  id: string;
  name: string;
  description: string | null;
  defaultCurrencyCode: string;
  createdBy: string;
  role?: HouseholdMember['role'];
  memberCount?: number;
  createdAt: string;
  updatedAt: string;
}

export const toHouseholdDto = (
  household: Household,
  extra?: { role?: HouseholdMember['role']; memberCount?: number },
): HouseholdDto => ({
  id: household.id,
  name: household.name,
  description: household.description,
  defaultCurrencyCode: household.defaultCurrencyCode,
  createdBy: household.createdBy,
  ...(extra?.role ? { role: extra.role } : {}),
  ...(extra?.memberCount !== undefined ? { memberCount: extra.memberCount } : {}),
  createdAt: household.createdAt.toISOString(),
  updatedAt: household.updatedAt.toISOString(),
});

export interface MemberDto {
  userId: string;
  role: HouseholdMember['role'];
  joinedAt: string;
  user: {
    id: string;
    username: string;
    displayName: string | null;
    avatarUrl: string | null;
    email: string;
  };
}

// Only the columns MemberDto exposes — a bare `user: true` would also load
// the password hash for every member of the household.
export const MEMBER_INCLUDE = {
  user: {
    select: { id: true, username: true, displayName: true, avatarUrl: true, email: true },
  },
} satisfies Prisma.HouseholdMemberInclude;

export type MemberWithUser = Prisma.HouseholdMemberGetPayload<{
  include: typeof MEMBER_INCLUDE;
}>;

export const toMemberDto = (member: MemberWithUser): MemberDto => ({
  userId: member.userId,
  role: member.role,
  joinedAt: member.joinedAt.toISOString(),
  user: {
    id: member.user.id,
    username: member.user.username,
    displayName: member.user.displayName,
    avatarUrl: member.user.avatarUrl,
    email: member.user.email,
  },
});
