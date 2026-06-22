import type { RequestHandler } from 'express';
import type { ZodType } from 'zod';

export interface ValidationSchemas {
  body?: ZodType;
  params?: ZodType;
  query?: ZodType;
}

/**
 * Middleware de validación con Zod.
 *
 * Parsea `body`, `params` y `query` según los schemas provistos y reemplaza
 * los valores en `req` con la versión ya validada y coercionada, de modo que
 * los controllers reciban datos tipados y limpios.
 *
 * En Express 5 `req.query` es de solo lectura, por eso el query validado se
 * expone en `req.validatedQuery` (ver src/types/express.d.ts).
 *
 * Si la validación falla, el ZodError se propaga al `errorMiddleware`, que
 * responde 422 con el detalle por campo. El formato es idéntico al del resto
 * de los errores de validación de la app.
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
