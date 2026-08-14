import bcrypt from 'bcrypt';
import { env } from '../config/env';

/**
 * bcrypt silently truncates input past 72 bytes, which would make
 * "longpassword...A" and "longpassword...B" equivalent. Reject instead.
 */
export const MAX_PASSWORD_BYTES = 72;

/**
 * A precomputed hash of a value nobody can log in with. Used to burn the same
 * ~100ms of CPU on a nonexistent email as on a real one, so response timing
 * does not reveal which accounts exist.
 */
const DUMMY_HASH = '$2b$12$C6UzMDM.H6dfI/f/IKcEe.eS0PIhOWtIw2GKrn/CNRWvpMoHKMbmC';

export function passwordByteLength(password: string): number {
  return Buffer.byteLength(password, 'utf8');
}

export async function hashPassword(password: string): Promise<string> {
  if (passwordByteLength(password) > MAX_PASSWORD_BYTES) {
    throw new Error(`Password exceeds ${MAX_PASSWORD_BYTES} bytes`);
  }
  return bcrypt.hash(password, env.BCRYPT_SALT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  // bcrypt.compare resolves false (rather than throwing) on a malformed hash.
  return bcrypt.compare(password, hash);
}

/** Equalises login timing when the email does not resolve to a user. */
export async function burnPasswordTiming(password: string): Promise<void> {
  await bcrypt.compare(password, DUMMY_HASH);
}
