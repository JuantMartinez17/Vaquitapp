import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../app/middleware/validate.middleware.js';
import { UnauthorizedError, NotFoundError } from '../../shared/errors/errors.js';
import { asyncHandler } from '../../shared/utils/asyncHandler.js';
import { routeParam } from '../../shared/utils/request.js';
import { readLocalFile, verifyLocalDownloadToken } from './local-file-storage.js';

/**
 * Backs the presigned URLs LocalFileStorage hands out (dev only — S3 serves
 * these directly). No `authMiddleware`/`requireHouseholdMember` here: the
 * signed, expiring token in the query string IS the authorization, exactly
 * like a real S3 presigned URL — membership was already checked once, when
 * the URL was issued.
 */
export const localFilesRouter = Router();

localFilesRouter.get(
  '/:key',
  validate({
    params: z.object({ key: z.string().min(1) }),
    query: z.object({ expiresAt: z.coerce.number(), signature: z.string().min(1) }),
  }),
  asyncHandler(async (req, res) => {
    const key = routeParam(req, 'key');
    const { expiresAt, signature } = req.validatedQuery as { expiresAt: number; signature: string };

    if (!verifyLocalDownloadToken(key, expiresAt, signature)) {
      throw new UnauthorizedError('Expired or invalid download link');
    }

    try {
      const buffer = await readLocalFile(key);
      res.send(buffer);
    } catch {
      throw new NotFoundError('File not found');
    }
  }),
);
