import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { MulterError } from 'multer';
import { AppError } from '../../shared/errors/errors.js';
import { ErrorCode } from '../../shared/errors/codes.js';

export const errorMiddleware = (err: Error, req: Request, res: Response, _next: NextFunction) => {
  // Zod validation errors
  if (err instanceof ZodError) {
    return res.status(422).json({
      error: {
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Invalid data',
        details: err.flatten().fieldErrors,
      },
    });
  }

  // multer rejects an oversized upload before our own handler ever runs.
  if (err instanceof MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        error: { code: ErrorCode.ATTACHMENT_TOO_LARGE, message: 'File exceeds the size limit' },
      });
    }
    return res.status(400).json({ error: { code: ErrorCode.BAD_REQUEST, message: err.message } });
  }

  // Our own controlled errors
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
        ...(err.details ? { details: err.details } : {}),
      },
    });
  }

  // Anything else: unexpected error
  req.log?.error({ err, path: req.path }, 'Unhandled error');

  return res.status(500).json({
    error: {
      code: ErrorCode.INTERNAL_ERROR,
      message: 'Something went wrong',
    },
  });
};
