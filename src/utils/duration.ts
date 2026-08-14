const UNIT_SECONDS: Record<string, number> = {
  s: 1,
  m: 60,
  h: 60 * 60,
  d: 24 * 60 * 60,
};

/**
 * Parses a `jsonwebtoken`-style duration ("15m", "1h", "7d", "900") into
 * seconds. Returns null when the input is not a valid duration, so callers can
 * surface a configuration error instead of silently using a wrong lifetime.
 */
export function parseDuration(value: string): number | null {
  const match = /^(\d+)\s*([smhd])?$/.exec(value.trim());
  if (!match) return null;

  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const unit = match[2] ?? 's';
  const multiplier = UNIT_SECONDS[unit];
  if (multiplier === undefined) return null;

  return amount * multiplier;
}
