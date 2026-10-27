import { prisma } from '../../infrastructure/database/prisma.js';
import { ConflictError, BadRequestError, UnauthorizedError } from '../../shared/errors/errors.js';
import { ErrorCode } from '../../shared/errors/codes.js';
import { isUniqueConstraintViolation } from '../../shared/utils/prisma-errors.js';
import type { User } from '../../generated/prisma/client.js';
import type { RegisterDto, LoginDto } from './auth.schema.js';
import { hashPassword, verifyPassword } from './auth.password.js';
import {
  signAccessToken,
  generateRefreshToken,
  hashToken,
  refreshTokenExpiry,
} from './auth.tokens.js';

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

/**
 * Looks up who already owns the email or username and builds the matching
 * conflict. Used both before the insert and after losing an insert race, so
 * the client sees the same code either way (the email wins when both clash).
 */
const findRegistrationConflict = async (
  input: Pick<RegisterDto, 'email' | 'username'>,
): Promise<ConflictError | null> => {
  const owners = await prisma.user.findMany({
    where: { OR: [{ email: input.email }, { username: input.username }] },
    select: { email: true },
  });
  if (owners.length === 0) {
    return null;
  }
  if (owners.some((owner) => owner.email === input.email)) {
    return new ConflictError(
      'A user with that email already exists',
      ErrorCode.EMAIL_ALREADY_REGISTERED,
    );
  }
  return new ConflictError('That username is already taken', ErrorCode.USERNAME_TAKEN);
};

export const register = async (input: RegisterDto, meta: RequestMeta): Promise<AuthResult> => {
  const conflict = await findRegistrationConflict(input);
  if (conflict) {
    throw conflict;
  }

  if (input.preferredCurrencyCode) {
    await assertCurrencyExists(input.preferredCurrencyCode);
  }

  const passwordHash = await hashPassword(input.password);
  let user: User;
  try {
    user = await prisma.user.create({
      data: {
        email: input.email,
        username: input.username,
        passwordHash,
        displayName: input.displayName ?? null,
        preferredCurrencyCode: input.preferredCurrencyCode ?? 'ARS',
      },
    });
  } catch (error) {
    // The pre-check above is only a fast path: two concurrent registrations
    // can both pass it, and the unique indexes are the real guard.
    if (isUniqueConstraintViolation(error)) {
      throw (await findRegistrationConflict(input)) ?? error;
    }
    throw error;
  }

  return { user, ...(await issueTokens(user, meta)) };
};

export const login = async (input: LoginDto, meta: RequestMeta): Promise<AuthResult> => {
  const user = await prisma.user.findFirst({ where: { email: input.email, deletedAt: null } });
  // The compare runs even when the email is unknown (against a dummy hash) so
  // the response time doesn't reveal which emails exist.
  const passwordMatches = await verifyPassword(input.password, user?.passwordHash ?? null);
  // Generic message: we don't reveal whether the email or the password failed.
  if (!user || !passwordMatches) {
    throw new UnauthorizedError('Invalid credentials', ErrorCode.INVALID_CREDENTIALS);
  }
  return { user, ...(await issueTokens(user, meta)) };
};

/** A reused refresh token is treated as theft: every session of the user is revoked. */
const rejectReusedToken = async (userId: string): Promise<never> => {
  await logoutAll(userId);
  throw new UnauthorizedError(
    'Refresh token reused; all sessions were revoked',
    ErrorCode.TOKEN_REUSE_DETECTED,
  );
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
    return rejectReusedToken(stored.userId);
  }

  if (stored.expiresAt < new Date()) {
    throw new UnauthorizedError('Refresh token expired');
  }

  const user = await prisma.user.findFirst({ where: { id: stored.userId, deletedAt: null } });
  if (!user) {
    throw new UnauthorizedError('User not found');
  }

  const newRefreshToken = generateRefreshToken();
  const rotated = await prisma.$transaction(async (tx) => {
    // Revoking with `revokedAt: null` in the filter makes the rotation a
    // compare-and-swap: of two concurrent requests with the same token,
    // exactly one sees count 1. Reading `stored.revokedAt` above is not enough,
    // both requests would pass that check before either writes.
    const claimed = await tx.refreshToken.updateMany({
      where: { id: stored.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (claimed.count === 0) {
      return false;
    }
    await tx.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(newRefreshToken),
        expiresAt: refreshTokenExpiry(),
        userAgent: meta.userAgent ?? null,
        ipAddress: meta.ipAddress ?? null,
      },
    });
    return true;
  });

  if (!rotated) {
    // Outside the transaction on purpose: throwing inside it would roll back
    // the revocation of the winner's freshly issued token.
    return rejectReusedToken(stored.userId);
  }

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
