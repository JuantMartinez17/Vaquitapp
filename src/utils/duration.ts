/**
 * Parses durations like "15m", "30d", "12h", "45s" into milliseconds.
 * Used to derive refresh-token expiry from environment variables
 * (JWT_REFRESH_TTL and friends).
 */

const UNIT_MS = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
} as const;

type DurationUnit = keyof typeof UNIT_MS;

export const parseDurationMs = (value: string): number => {
  const match = /^(\d+)(s|m|h|d)$/.exec(value.trim());
  if (!match) {
    throw new Error(`Invalid duration: "${value}" (expected a format like 45s, 15m, 12h, 30d)`);
  }
  // The regex guarantees both groups, and that group 2 is a known unit.
  const amount = Number(match[1]);
  const unit = match[2] as DurationUnit;
  return amount * UNIT_MS[unit];
};

export const parseDurationSeconds = (value: string): number =>
  Math.floor(parseDurationMs(value) / 1000);
