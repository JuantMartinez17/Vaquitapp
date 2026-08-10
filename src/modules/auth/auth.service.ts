import bcrypt from 'bcrypt';
import { prisma } from '../../config/prisma.js';
import { ConflictError, BadRequestError, UnauthorizedError } from '../../utils/errors.js';
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

/** Crea un refresh token persistido (hash) y devuelve el par de tokens. */
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
    throw new BadRequestError(`Moneda no soportada: ${code}`);
  }
};

export const register = async (input: RegisterDto, meta: RequestMeta): Promise<AuthResult> => {
  const existing = await prisma.user.findFirst({
    where: { OR: [{ email: input.email }, { username: input.username }] },
  });
  if (existing) {
    throw new ConflictError('Ya existe un usuario con ese email o username');
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
  // Mensaje genérico: no revelamos si falló el email o la contraseña.
  if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) {
    throw new UnauthorizedError('Credenciales inválidas');
  }
  return { user, ...(await issueTokens(user, meta)) };
};

/**
 * Rotación de refresh token con detección de reuso.
 * Si llega un token ya revocado → se asume robo y se revocan TODAS las sesiones.
 */
export const refresh = async (rawToken: string, meta: RequestMeta): Promise<TokenPair> => {
  const tokenHash = hashToken(rawToken);
  const stored = await prisma.refreshToken.findUnique({ where: { tokenHash } });
  if (!stored) {
    throw new UnauthorizedError('Refresh token inválido');
  }

  if (stored.revokedAt) {
    await prisma.refreshToken.updateMany({
      where: { userId: stored.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    throw new UnauthorizedError('Refresh token reutilizado; se revocaron todas las sesiones');
  }

  if (stored.expiresAt < new Date()) {
    throw new UnauthorizedError('Refresh token expirado');
  }

  const user = await prisma.user.findFirst({ where: { id: stored.userId, deletedAt: null } });
  if (!user) {
    throw new UnauthorizedError('Usuario no encontrado');
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

/** Revoca un refresh token puntual (logout de la sesión actual). */
export const logout = async (rawToken: string): Promise<void> => {
  await prisma.refreshToken.updateMany({
    where: { tokenHash: hashToken(rawToken), revokedAt: null },
    data: { revokedAt: new Date() },
  });
};

/** Revoca todas las sesiones activas del usuario. */
export const logoutAll = async (userId: string): Promise<void> => {
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
};
