import { randomBytes, createHash } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { SignOptions } from 'jsonwebtoken';
import { env } from '../../app/config.js';
import { parseDurationMs } from '../../shared/utils/duration.js';

export interface AccessTokenPayload {
  sub: string; // userId
  email: string;
}

/** Firma un access token (JWT de corta vida). */
export const signAccessToken = (payload: AccessTokenPayload): string =>
  jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_TTL as SignOptions['expiresIn'],
  });

/** Verifica un access token y devuelve el payload tipado. Lanza si es inválido. */
export const verifyAccessToken = (token: string): AccessTokenPayload => {
  const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET);
  if (typeof decoded === 'string' || !decoded.sub || typeof decoded.email !== 'string') {
    throw new Error('Access token inválido');
  }
  return { sub: String(decoded.sub), email: decoded.email };
};

/**
 * Genera un refresh token OPACO (no JWT): string aleatorio.
 * En la base solo guardamos su hash, nunca el token en claro.
 */
export const generateRefreshToken = (): string => randomBytes(32).toString('base64url');

/** Hash SHA-256 (hex) del token. Lo que se persiste en RefreshToken.tokenHash. */
export const hashToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

/** Fecha de expiración de un refresh token, según JWT_REFRESH_TTL. */
export const refreshTokenExpiry = (from: Date = new Date()): Date =>
  new Date(from.getTime() + parseDurationMs(env.JWT_REFRESH_TTL));
