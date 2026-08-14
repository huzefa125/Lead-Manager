import { describe, expect, it } from 'vitest';
import { MAX_PASSWORD_BYTES, hashPassword, passwordByteLength, verifyPassword } from '../../src/utils/password';

describe('password hashing', () => {
  it('produces a bcrypt hash that verifies', async () => {
    const hash = await hashPassword('CorrectHorse1');

    expect(hash).toMatch(/^\$2[aby]\$/);
    expect(hash).not.toContain('CorrectHorse1');
    await expect(verifyPassword('CorrectHorse1', hash)).resolves.toBe(true);
  });

  it('salts — the same password hashes differently every time', async () => {
    const [a, b] = await Promise.all([hashPassword('CorrectHorse1'), hashPassword('CorrectHorse1')]);
    expect(a).not.toBe(b);
  });

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('CorrectHorse1');
    await expect(verifyPassword('correcthorse1', hash)).resolves.toBe(false);
    await expect(verifyPassword('', hash)).resolves.toBe(false);
  });

  it('returns false rather than throwing on a malformed hash', async () => {
    await expect(verifyPassword('anything', 'not-a-bcrypt-hash')).resolves.toBe(false);
  });

  it('refuses a password past bcrypt\'s 72-byte truncation point', async () => {
    await expect(hashPassword('A'.repeat(MAX_PASSWORD_BYTES + 1))).rejects.toThrow(/72 bytes/);
  });

  it('measures length in bytes, not characters', () => {
    // 18 emoji are 72 bytes — the limit is reached long before 72 characters.
    expect(passwordByteLength('🔒'.repeat(18))).toBe(72);
    expect(passwordByteLength('abc')).toBe(3);
  });
});
