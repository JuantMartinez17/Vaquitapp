import type { User } from '../../generated/prisma/client.js';

/** DTO público de usuario: nunca expone passwordHash ni deletedAt. */
export interface UserDto {
  id: string;
  email: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  preferredCurrencyCode: string;
  emailVerified: boolean;
  createdAt: string;
  updatedAt: string;
}

export const toUserDto = (user: User): UserDto => ({
  id: user.id,
  email: user.email,
  username: user.username,
  displayName: user.displayName,
  avatarUrl: user.avatarUrl,
  preferredCurrencyCode: user.preferredCurrencyCode,
  emailVerified: user.emailVerified,
  createdAt: user.createdAt.toISOString(),
  updatedAt: user.updatedAt.toISOString(),
});
