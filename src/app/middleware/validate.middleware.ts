import type { RequestHandler } from 'express';
import type { ZodType } from 'zod';

export interface ValidationSchemas {
  body?: ZodType;
  params?: ZodType;
  query?: ZodType;
}

/**
 * Zod-based validation middleware.
 *
 * Parses `body`, `params` and `query` against the given schemas and replaces
 * the values on `req` with the validated, coerced version, so controllers
 * receive typed, clean data.
 *
 * In Express 5, `req.query` is read-only, so the validated query is exposed
 * on `req.validatedQuery` instead (see src/shared/types/express.d.ts).
 *
 * On failure, the ZodError propagates to `errorMiddleware`, which responds
 * with 422 and a per-field breakdown — the same shape as every other
 * validation error in the app.
 */
export const validate = (schemas: ValidationSchemas): RequestHandler => {
  return (req, _res, next) => {
    try {
      if (schemas.params) {
        req.params = schemas.params.parse(req.params) as typeof req.params;
      }
      if (schemas.body) {
        req.body = schemas.body.parse(req.body);
      }
      if (schemas.query) {
        req.validatedQuery = schemas.query.parse(req.query);
      }
      next();
    } catch (err) {
      next(err);
    }
  };
};
