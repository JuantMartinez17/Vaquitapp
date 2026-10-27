import { Request, Response, NextFunction } from 'express';
import { ZodError, z } from 'zod';
import { MulterError } from 'multer';
import {
  AppError,
  ConflictError,
  NotFoundError,
  PayloadTooLargeError,
  ServiceUnavailableError,
  UnsupportedMediaTypeError,
  BadRequestError,
} from '../../shared/errors/errors.js';
import { ErrorCode } from '../../shared/errors/codes.js';
import { logger } from '../../infrastructure/logging/logger.js';
import { classifyDatabaseError } from '../../infrastructure/database/prisma-errors.js';

// How long clients are told to wait when the database is unreachable.
const DATABASE_RETRY_AFTER_SECONDS = 5;

interface BodyParserError extends Error {
  status: number;
  type?: string;
}

// body-parser (express.json) rejects with http-errors objects: a numeric 4xx
// `status` plus a `type` such as "entity.parse.failed" or "entity.too.large".
const isBodyParserError = (err: Error): err is BodyParserError => {
  const candidate = err as Partial<BodyParserError>;
  return (
    typeof candidate.status === 'number' &&
    candidate.status >= 400 &&
    candidate.status < 500 &&
    typeof candidate.type === 'string'
  );
};

const toAppError = (err: Error): AppError | null => {
  if (err instanceof AppError) {
    return err;
  }

  // multer rejects an oversized upload before our own handler ever runs.
  if (err instanceof MulterError) {
    return err.code === 'LIMIT_FILE_SIZE'
      ? new PayloadTooLargeError('File exceeds the size limit', ErrorCode.ATTACHMENT_TOO_LARGE)
      : new BadRequestError(err.message);
  }

  if (isBodyParserError(err)) {
    if (err.status === 413) {
      return new PayloadTooLargeError('Request body is too large');
    }
    if (err.status === 415) {
      return new UnsupportedMediaTypeError('Unsupported request content type or encoding');
    }
    return new BadRequestError(
      err.type === 'entity.parse.failed' ? 'Malformed JSON body' : 'Invalid request body',
    );
  }

  switch (classifyDatabaseError(err)) {
    case 'unique-violation':
      return new ConflictError('Resource already exists');
    case 'not-found':
      return new NotFoundError('Resource not found');
    case 'unavailable':
      return new ServiceUnavailableError(
        'Database temporarily unavailable',
        ErrorCode.SERVICE_UNAVAILABLE,
        DATABASE_RETRY_AFTER_SECONDS,
      );
    default:
      return null;
  }
};

export const errorMiddleware = (err: Error, req: Request, res: Response, next: NextFunction) => {
  // Once the response has started, writing a JSON error would throw
  // ERR_HTTP_HEADERS_SENT. Delegating lets Express's default handler close
  // the socket, which is the only honest signal left for a truncated reply.
  if (res.headersSent) {
    (req.log ?? logger).error({ err, path: req.path }, 'Error after response started');
    return next(err);
  }

  if (err instanceof ZodError) {
    const { fieldErrors, formErrors } = z.flattenError(err);
    return res.status(422).json({
      error: {
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Invalid data',
        // Root-level issues (unknown keys under .strict(), cross-field
        // refinements) have no field path, so they would otherwise vanish.
        details: formErrors.length > 0 ? { ...fieldErrors, formErrors } : fieldErrors,
      },
    });
  }

  const appError = toAppError(err);
  if (appError) {
    // A mapped infrastructure failure is still a server-side problem worth a
    // log line; client mistakes (4xx) are not.
    if (appError.statusCode >= 500) {
      (req.log ?? logger).warn(
        { err, path: req.path },
        'Request failed with a service-level error',
      );
    }
    if (appError instanceof ServiceUnavailableError && appError.retryAfterSeconds !== undefined) {
      res.setHeader('Retry-After', String(appError.retryAfterSeconds));
    }
    return res.status(appError.statusCode).json({
      error: {
        code: appError.code,
        message: appError.message,
        ...(appError.details ? { details: appError.details } : {}),
      },
    });
  }

  // Anything else: unexpected error. The message and stack stay in the log,
  // never in the response.
  (req.log ?? logger).error({ err, path: req.path }, 'Unhandled error');

  return res.status(500).json({
    error: {
      code: ErrorCode.INTERNAL_ERROR,
      message: 'Something went wrong',
    },
  });
};
