import type { RequestHandler } from 'express';
import { verifyAccessToken } from '../modules/auth/auth.tokens.js';
import { UnauthorizedError } from '../utils/errors.js';

/**
 * Exige un access token válido en `Authorization: Bearer <token>` y completa
 * `req.user` con `{ id, email }`. Si falta o es inválido, lanza 401.
 */
export const authMiddleware: RequestHandler = (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    throw new UnauthorizedError('Falta el token de acceso (Authorization: Bearer <token>)');
  }

  const token = header.slice('Bearer '.length).trim();
  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch {
    throw new UnauthorizedError('Access token inválido o expirado');
  }

  req.user = { id: payload.sub, email: payload.email };
  next();
};
