/**
 * True when Prisma reports a unique-constraint violation (P2002). This is how
 * a lost insert race surfaces, so callers use it to turn the race into the same
 * domain error as the sequential "already exists" case.
 */
export const isUniqueConstraintViolation = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
