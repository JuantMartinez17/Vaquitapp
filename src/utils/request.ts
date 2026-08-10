import type { Request } from 'express';

/**
 * Lee un parámetro de ruta como `string`. Los tipos de Express 5 los declaran
 * como `string | string[]`, pero nuestras rutas los validan como string único
 * (UUID) con Zod, así que normalizamos al primer valor.
 */
export const routeParam = (req: Request, name: string): string => {
  const value = req.params[name];
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
};
