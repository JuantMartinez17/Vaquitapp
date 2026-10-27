import type { RequestHandler } from 'express';
import { env } from '../../app/config.js';
import { ErrorCode } from '../../shared/errors/codes.js';
import { ServiceUnavailableError } from '../../shared/errors/errors.js';

const RETRY_AFTER_SECONDS = 5;

/**
 * Caps how many uploads are processed at once. Each one is buffered fully in
 * memory (up to MAX_UPLOAD_BYTES) and then hashed, so on a 512 MB instance a
 * burst of large uploads is the quickest way to run out of heap. Excess
 * requests are refused up front, before multer buffers a single byte, with a
 * 503 and Retry-After instead of being queued (a queue would hold the
 * sockets, and their buffers, anyway).
 */
export const createUploadConcurrencyLimiter = (limit: number): RequestHandler => {
  let active = 0;

  return (_req, res, next) => {
    if (active >= limit) {
      next(
        new ServiceUnavailableError(
          'Too many uploads in progress, retry shortly',
          ErrorCode.UPLOAD_CAPACITY_EXCEEDED,
          RETRY_AFTER_SECONDS,
        ),
      );
      return;
    }

    active++;
    let isReleased = false;
    // 'close' fires after a normal finish and also when the client drops
    // mid-upload, so a slot can never leak; the flag makes release idempotent.
    res.once('close', () => {
      if (!isReleased) {
        isReleased = true;
        active--;
      }
    });
    next();
  };
};

export const uploadConcurrencyLimiter = createUploadConcurrencyLimiter(env.UPLOAD_CONCURRENCY);
