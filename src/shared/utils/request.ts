import type { Request } from 'express';

/**
 * Reads a route param as a `string`. Express 5's types declare params as
 * `string | string[]`, but our routes validate them as a single string
 * (UUID) with Zod, so we normalize to the first value.
 */
export const routeParam = (req: Request, name: string): string => {
  const value = req.params[name];
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
};
