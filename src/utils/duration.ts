/**
 * Parseo de duraciones tipo "15m", "30d", "12h", "45s" a milisegundos.
 * Se usa para derivar la expiración de los refresh tokens a partir de las
 * variables de entorno (JWT_REFRESH_TTL, etc.).
 */

const UNIT_MS: Record<string, number> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

export const parseDurationMs = (value: string): number => {
  const match = /^(\d+)(s|m|h|d)$/.exec(value.trim());
  if (!match) {
    throw new Error(`Duración inválida: "${value}" (usá formato como 45s, 15m, 12h, 30d)`);
  }
  const amount = Number(match[1]);
  const unit = match[2] as keyof typeof UNIT_MS;
  return amount * UNIT_MS[unit];
};

export const parseDurationSeconds = (value: string): number =>
  Math.floor(parseDurationMs(value) / 1000);
