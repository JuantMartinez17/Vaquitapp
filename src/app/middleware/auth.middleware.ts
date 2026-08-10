import type { RequestHandler } from 'express';
import { verifyAccessToken } from '../../modules/auth/auth.tokens.js';
import { UnauthorizedError } from '../../shared/errors/errors.js';

/**
 * Requires a valid access token in `Authorization: Bearer <token>` and
 * populates `req.user` with `{ id, email }`. Throws 401 if missing or invalid.
 */
export const authMiddleware: RequestHandler = (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    throw new UnauthorizedError('Missing access token (Authorization: Bearer <token>)');
  }

  const token = header.slice('Bearer '.length).trim();
  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch {
    throw new UnauthorizedError('Invalid or expired access token');
  }

  req.user = { id: payload.sub, email: payload.email };
  next();
};
