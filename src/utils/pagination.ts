import { z } from 'zod';

/**
 * Paginación basada en cursor (estable y eficiente a medida que crecen las
 * listas, a diferencia del offset). Se usa en endpoints de listado como
 * gastos y settlements.
 */

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

/** Schema reutilizable para el query string de listados. */
export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).optional(),
  cursor: z.string().optional(),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export interface PaginationParams {
  take: number;
  cursor?: string;
}

export interface Page<T> {
  data: T[];
  nextCursor: string | null;
}

export const parsePagination = (
  query: PaginationQuery,
  opts?: { defaultLimit?: number; maxLimit?: number },
): PaginationParams => {
  const defaultLimit = opts?.defaultLimit ?? DEFAULT_LIMIT;
  const maxLimit = opts?.maxLimit ?? MAX_LIMIT;
  const requested = query.limit ?? defaultLimit;
  const take = Math.min(Math.max(requested, 1), maxLimit);
  return { take, cursor: query.cursor };
};

/**
 * Construye una página a partir de los items traídos de Prisma.
 *
 * Convención: pedir `take + 1` filas a la base. Si vienen más que `take`,
 * hay próxima página y el `nextCursor` es el id del último item devuelto.
 */
export const buildPage = <T extends { id: string }>(items: T[], take: number): Page<T> => {
  const hasMore = items.length > take;
  const data = hasMore ? items.slice(0, take) : items;
  const nextCursor = hasMore ? (data[data.length - 1]?.id ?? null) : null;
  return { data, nextCursor };
};
