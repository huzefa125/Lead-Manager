import { describe, expect, it } from 'vitest';
import { generateOpaqueToken, parseOpaqueToken, sha256, timingSafeEqualHex } from '../../src/utils/crypto';

describe('opaque refresh tokens', () => {
  it('emits an id.secret pair whose hash matches the secret', () => {
    const { token, id, hash } = generateOpaqueToken();
    const parsed = parseOpaqueToken(token);

    expect(parsed).not.toBeNull();
    expect(parsed?.id).toBe(id);
    expect(sha256(parsed!.secret)).toBe(hash);
  });

  it('never stores the secret itself — the hash does not contain it', () => {
    const { token, hash } = generateOpaqueToken();
    const secret = token.split('.')[1] ?? '';

    expect(secret.length).toBeGreaterThan(0);
    expect(hash).not.toContain(secret);
    expect(hash).toHaveLength(64);
  });

  it('generates a distinct token every call', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => generateOpaqueToken().token));
    expect(tokens.size).toBe(200);
  });

  it('rejects malformed tokens before they reach the database', () => {
    expect(parseOpaqueToken('no-separator')).toBeNull();
    expect(parseOpaqueToken('.leading')).toBeNull();
    expect(parseOpaqueToken('trailing.')).toBeNull();
    expect(parseOpaqueToken('')).toBeNull();
    // Non-uuid id — would otherwise hit a uuid-typed column.
    expect(parseOpaqueToken("'; DROP TABLE users;--.secret")).toBeNull();
  });

  it('compares digests safely and correctly', () => {
    const a = sha256('value');
    expect(timingSafeEqualHex(a, a)).toBe(true);
    expect(timingSafeEqualHex(a, sha256('other'))).toBe(false);
    // Mismatched lengths must not throw.
    expect(timingSafeEqualHex(a, 'ab')).toBe(false);
    expect(timingSafeEqualHex('', '')).toBe(false);
  });
});
