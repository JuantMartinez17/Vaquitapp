import bcrypt from 'bcrypt';
import { prisma } from '../../infrastructure/database/prisma.js';
import { ConflictError, BadRequestError, UnauthorizedError } from '../../shared/errors/errors.js';
import { ErrorCode } from '../../shared/errors/codes.js';
import type { User } from '../../generated/prisma/client.js';
import type { RegisterDto, LoginDto } from './auth.schema.js';
import {
  signAccessToken,
  generateRefreshToken,
  hashToken,
  refreshTokenExpiry,
} from './auth.tokens.js';

const BCRYPT_COST = 12;

export interface RequestMeta {
  userAgent?: string;
  ipAddress?: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface AuthResult extends TokenPair {
  user: User;
}

/** Creates a persisted (hashed) refresh token and returns the token pair. */
const issueTokens = async (user: User, meta: RequestMeta): Promise<TokenPair> => {
  const refreshToken = generateRefreshToken();
  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(refreshToken),
      expiresAt: refreshTokenExpiry(),
      userAgent: meta.userAgent ?? null,
      ipAddress: meta.ipAddress ?? null,
    },
  });
  return { accessToken: signAccessToken({ sub: user.id, email: user.email }), refreshToken };
};

const assertCurrencyExists = async (code: string): Promise<void> => {
  const currency = await prisma.currency.findUnique({ where: { code } });
  if (!currency) {
    throw new BadRequestError(`Unsupported currency: ${code}`);
  }
};

export const register = async (input: RegisterDto, meta: RequestMeta): Promise<AuthResult> => {
  const existing = await prisma.user.findFirst({
    where: { OR: [{ email: input.email }, { username: input.username }] },
  });
  if (existing) {
    throw new ConflictError(
      'A user with that email or username already exists',
      ErrorCode.EMAIL_ALREADY_REGISTERED,
    );
  }

  if (input.preferredCurrencyCode) {
    await assertCurrencyExists(input.preferredCurrencyCode);
  }

  const passwordHash = await bcrypt.hash(input.password, BCRYPT_COST);
  const user = await prisma.user.create({
    data: {
      email: input.email,
      username: input.username,
      passwordHash,
      displayName: input.displayName ?? null,
      preferredCurrencyCode: input.preferredCurrencyCode ?? 'ARS',
    },
  });

  return { user, ...(await issueTokens(user, meta)) };
};

export const login = async (input: LoginDto, meta: RequestMeta): Promise<AuthResult> => {
  const user = await prisma.user.findFirst({ where: { email: input.email, deletedAt: null } });
  // Generic message: we don't reveal whether the email or the password failed.
  if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) {
    throw new UnauthorizedError('Invalid credentials', ErrorCode.INVALID_CREDENTIALS);
  }
  return { user, ...(await issueTokens(user, meta)) };
};

/**
 * Refresh token rotation with reuse detection.
 * If an already-revoked token comes in, we assume theft and revoke ALL sessions.
 */
export const refresh = async (rawToken: string, meta: RequestMeta): Promise<TokenPair> => {
  const tokenHash = hashToken(rawToken);
  const stored = await prisma.refreshToken.findUnique({ where: { tokenHash } });
  if (!stored) {
    throw new UnauthorizedError('Invalid refresh token');
  }

  if (stored.revokedAt) {
    await prisma.refreshToken.updateMany({
      where: { userId: stored.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    throw new UnauthorizedError(
      'Refresh token reused; all sessions were revoked',
      ErrorCode.TOKEN_REUSE_DETECTED,
    );
  }

  if (stored.expiresAt < new Date()) {
    throw new UnauthorizedError('Refresh token expired');
  }

  const user = await prisma.user.findFirst({ where: { id: stored.userId, deletedAt: null } });
  if (!user) {
    throw new UnauthorizedError('User not found');
  }

  const newRefreshToken = generateRefreshToken();
  await prisma.$transaction([
    prisma.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } }),
    prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(newRefreshToken),
        expiresAt: refreshTokenExpiry(),
        userAgent: meta.userAgent ?? null,
        ipAddress: meta.ipAddress ?? null,
      },
    }),
  ]);

  return {
    accessToken: signAccessToken({ sub: user.id, email: user.email }),
    refreshToken: newRefreshToken,
  };
};

/** Revokes a single refresh token (logout of the current session). */
export const logout = async (rawToken: string): Promise<void> => {
  await prisma.refreshToken.updateMany({
    where: { tokenHash: hashToken(rawToken), revokedAt: null },
    data: { revokedAt: new Date() },
  });
};

/** Revokes every active session for the user. */
export const logoutAll = async (userId: string): Promise<void> => {
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
};
