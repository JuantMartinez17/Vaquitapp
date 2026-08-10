import type { Group, GroupMember, User } from '../../generated/prisma/client.js';

export interface GroupDto {
  id: string;
  name: string;
  description: string | null;
  defaultCurrencyCode: string;
  createdBy: string;
  role?: GroupMember['role'];
  memberCount?: number;
  createdAt: string;
  updatedAt: string;
}

export const toGroupDto = (
  group: Group,
  extra?: { role?: GroupMember['role']; memberCount?: number },
): GroupDto => ({
  id: group.id,
  name: group.name,
  description: group.description,
  defaultCurrencyCode: group.defaultCurrencyCode,
  createdBy: group.createdBy,
  ...(extra?.role ? { role: extra.role } : {}),
  ...(extra?.memberCount !== undefined ? { memberCount: extra.memberCount } : {}),
  createdAt: group.createdAt.toISOString(),
  updatedAt: group.updatedAt.toISOString(),
});

export interface MemberDto {
  userId: string;
  role: GroupMember['role'];
  joinedAt: string;
  user: {
    id: string;
    username: string;
    displayName: string | null;
    avatarUrl: string | null;
    email: string;
  };
}

export const toMemberDto = (member: GroupMember & { user: User }): MemberDto => ({
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
