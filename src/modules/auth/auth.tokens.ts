import { randomBytes, createHash } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { SignOptions } from 'jsonwebtoken';
import { env } from '../../app/config.js';
import { parseDurationMs } from '../../shared/utils/duration.js';

export interface AccessTokenPayload {
  sub: string; // userId
  email: string;
}

// Pinned on both sides: jsonwebtoken derives the accepted algorithms from the
// key type when none are given, and a token must never choose its own.
const JWT_ALGORITHM = 'HS256';

/** Signs a short-lived access token (JWT). */
export const signAccessToken = (payload: AccessTokenPayload): string =>
  jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    algorithm: JWT_ALGORITHM,
    expiresIn: env.JWT_ACCESS_TTL as SignOptions['expiresIn'],
  });

/** Verifies an access token and returns the typed payload. Throws if invalid. */
export const verifyAccessToken = (token: string): AccessTokenPayload => {
  const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: [JWT_ALGORITHM] });
  if (typeof decoded === 'string' || !decoded.sub || typeof decoded.email !== 'string') {
    throw new Error('Invalid access token payload');
  }
  return { sub: String(decoded.sub), email: decoded.email };
};

/**
 * Generates an OPAQUE refresh token (not a JWT): a random string.
 * Only its hash is stored in the database, never the token itself.
 */
export const generateRefreshToken = (): string => randomBytes(32).toString('base64url');

/** SHA-256 hash (hex) of the token: what gets persisted in RefreshToken.tokenHash. */
export const hashToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

/** Expiry date of a refresh token, per JWT_REFRESH_TTL. */
export const refreshTokenExpiry = (from: Date = new Date()): Date =>
  new Date(from.getTime() + parseDurationMs(env.JWT_REFRESH_TTL));
