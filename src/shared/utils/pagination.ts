import { z } from 'zod';

/**
 * Cursor-based pagination (stable and efficient as lists grow, unlike
 * offset). Used by listing endpoints such as expenses and settlements.
 */

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

/** Reusable schema for a listing endpoint's query string. */
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
 * Builds a page from the rows fetched via Prisma.
 *
 * Convention: request `take + 1` rows from the database. If more than `take`
 * come back, there is a next page and `nextCursor` is the id of the last item
 * returned.
 */
export const buildPage = <T extends { id: string }>(items: T[], take: number): Page<T> => {
  const hasMore = items.length > take;
  const data = hasMore ? items.slice(0, take) : items;
  const nextCursor = hasMore ? (data[data.length - 1]?.id ?? null) : null;
  return { data, nextCursor };
};
