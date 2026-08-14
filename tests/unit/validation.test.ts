import { describe, expect, it } from 'vitest';
import { loginSchema, registerSchema } from '../../src/auth/auth.validation';

describe('registration validation', () => {
  const valid = { email: 'User@Example.com', password: 'CorrectHorse1', name: '  Ada  ' };

  it('accepts a valid payload and normalises it', () => {
    const parsed = registerSchema.parse(valid);
    expect(parsed.email).toBe('user@example.com'); // lowercased
    expect(parsed.name).toBe('Ada'); // trimmed
  });

  it('strips fields the schema does not declare', () => {
    // Guards against mass assignment: a caller cannot make themselves an admin.
    const parsed = registerSchema.parse({ ...valid, role: 'ADMIN', isActive: false });
    expect(parsed).not.toHaveProperty('role');
    expect(parsed).not.toHaveProperty('isActive');
  });

  it.each([
    ['not-an-email', 'email'],
    ['', 'email'],
  ])('rejects invalid email %s', (email) => {
    expect(registerSchema.safeParse({ ...valid, email }).success).toBe(false);
  });

  it.each([
    ['short1A', 'too short'],
    ['alllowercase1', 'no uppercase'],
    ['ALLUPPERCASE1', 'no lowercase'],
    ['NoDigitsHere', 'no digit'],
  ])('rejects weak password %s (%s)', (password) => {
    expect(registerSchema.safeParse({ ...valid, password }).success).toBe(false);
  });

  it('rejects a password over 72 bytes', () => {
    const result = registerSchema.safeParse({ ...valid, password: `Aa1${'x'.repeat(80)}` });
    expect(result.success).toBe(false);
  });

  it('reports every problem at once, not just the first', () => {
    const result = registerSchema.safeParse({ email: 'bad', password: 'weak' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const fields = new Set(result.error.issues.map((issue) => issue.path.join('.')));
      expect(fields).toContain('email');
      expect(fields).toContain('password');
    }
  });
});

describe('login validation', () => {
  it('does not apply password policy rules', () => {
    // An account created before a policy change must still be able to sign in.
    const result = loginSchema.safeParse({ email: 'user@example.com', password: 'old' });
    expect(result.success).toBe(true);
  });

  it('still requires both fields', () => {
    expect(loginSchema.safeParse({ email: 'user@example.com', password: '' }).success).toBe(false);
    expect(loginSchema.safeParse({ password: 'x' }).success).toBe(false);
  });
});
