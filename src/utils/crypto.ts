import crypto from 'node:crypto';

/**
 * Refresh tokens are opaque, not JWTs: revocation must be authoritative, and a
 * self-contained token cannot be revoked without a database check anyway.
 *
 * Wire format is `<uuid>.<base64url secret>`. The uuid is the primary key, so
 * verification is a single indexed lookup instead of a table scan; the secret
 * is what is actually checked, and only its SHA-256 hash is stored.
 */
export interface OpaqueToken {
  /** Full value handed to the client. Never persisted. */
  token: string;
  /** Database primary key for the token row. */
  id: string;
  /** SHA-256 of the secret half. Safe to persist. */
  hash: string;
}

const SECRET_BYTES = 32;

export function generateOpaqueToken(): OpaqueToken {
  const id = crypto.randomUUID();
  const secret = crypto.randomBytes(SECRET_BYTES).toString('base64url');
  return { token: `${id}.${secret}`, id, hash: sha256(secret) };
}

export function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

/** Splits a presented token; returns null if it is not in `<id>.<secret>` form. */
export function parseOpaqueToken(token: string): { id: string; secret: string } | null {
  const separator = token.indexOf('.');
  if (separator <= 0 || separator === token.length - 1) return null;

  const id = token.slice(0, separator);
  const secret = token.slice(separator + 1);

  // The id is used directly in a uuid-typed query; reject anything malformed
  // before it reaches the database.
  if (!UUID_PATTERN.test(id)) return null;

  return { id, secret };
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Length-safe constant-time comparison of two hex digests. */
export function timingSafeEqualHex(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'hex');
  const bufferB = Buffer.from(b, 'hex');
  if (bufferA.length !== bufferB.length || bufferA.length === 0) return false;
  return crypto.timingSafeEqual(bufferA, bufferB);
}
