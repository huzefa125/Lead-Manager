import { describe, expect, it } from 'vitest';
import jwt from 'jsonwebtoken';
import { accessTokenExpiresInSeconds, signAccessToken, verifyAccessToken } from '../../src/utils/jwt';
import { env } from '../../src/config/env';
import { ApiError } from '../../src/utils/api-error';

const payload = {
  sub: 'a3f1c2d4-0000-4000-8000-000000000001',
  email: 'user@example.com',
  roles: ['user'],
  permissions: ['employee.view', 'department.view'],
};

/** Signs arbitrary claims with the real secret — for forging test cases. */
const signRaw = (claims: object, options: jwt.SignOptions = {}): string =>
  jwt.sign(claims, env.JWT_ACCESS_SECRET, {
    issuer: env.JWT_ISSUER,
    audience: env.JWT_AUDIENCE,
    expiresIn: '15m',
    ...options,
  });

describe('access tokens', () => {
  it('round-trips the claims it was signed with', () => {
    const claims = verifyAccessToken(signAccessToken(payload));

    expect(claims.sub).toBe(payload.sub);
    expect(claims.email).toBe(payload.email);
    expect(claims.roles).toEqual(['user']);
    expect(claims.permissions).toEqual(['employee.view', 'department.view']);
    expect(claims.type).toBe('access');
    expect(claims.jti).toEqual(expect.any(String));
  });

  it('carries permissions, so authorize() needs no database', () => {
    // This is the property the whole RBAC design rests on.
    const claims = verifyAccessToken(
      signAccessToken({ ...payload, roles: ['super_admin'], permissions: ['*'] }),
    );
    expect(claims.permissions).toEqual(['*']);
  });

  it('gives every token a unique jti', () => {
    const first = verifyAccessToken(signAccessToken(payload));
    const second = verifyAccessToken(signAccessToken(payload));
    expect(first.jti).not.toBe(second.jti);
  });

  it('verifies with no I/O — the secret alone is sufficient', () => {
    const token = signAccessToken(payload);
    expect(() => verifyAccessToken(token)).not.toThrow();
  });

  it('rejects a token signed with a different secret', () => {
    const forged = jwt.sign(
      { ...payload, type: 'access', jti: 'x' },
      'a-completely-different-secret-value',
      { issuer: env.JWT_ISSUER, audience: env.JWT_AUDIENCE, expiresIn: '15m' },
    );

    expect(() => verifyAccessToken(forged)).toThrow(ApiError);
  });

  it('rejects a payload tampered to add permissions', () => {
    // The attack the signature exists to stop: self-granting `*`.
    const token = signAccessToken(payload);
    const [header, , signature] = token.split('.');
    const escalated = Buffer.from(
      JSON.stringify({ ...payload, permissions: ['*'], type: 'access', jti: 'x' }),
    ).toString('base64url');

    expect(() => verifyAccessToken(`${header}.${escalated}.${signature}`)).toThrow(ApiError);
  });

  it('rejects an expired token with TOKEN_EXPIRED', () => {
    const expired = signRaw({ ...payload, type: 'access', jti: 'x' }, { expiresIn: '-1s' });

    expect(() => verifyAccessToken(expired)).toThrowError(
      expect.objectContaining({ code: 'TOKEN_EXPIRED', statusCode: 401 }),
    );
  });

  it('rejects a token issued for a different audience', () => {
    const wrongAudience = signRaw(
      { ...payload, type: 'access', jti: 'x' },
      { audience: 'some-other-service' },
    );

    expect(() => verifyAccessToken(wrongAudience)).toThrow(ApiError);
  });

  it('rejects a refresh-shaped token presented as an access token', () => {
    expect(() => verifyAccessToken(signRaw({ ...payload, type: 'refresh', jti: 'x' }))).toThrow(
      ApiError,
    );
  });

  it('rejects a pre-RBAC token carrying a single role string', () => {
    // Legacy shape: `role: 'USER'` with no permissions array. Admitting it
    // would authenticate the user with zero permissions and produce confusing
    // 403s, so it is rejected and they re-authenticate once.
    const legacy = signRaw({
      sub: payload.sub,
      email: payload.email,
      role: 'USER',
      type: 'access',
      jti: 'x',
    });

    expect(() => verifyAccessToken(legacy)).toThrow(ApiError);
  });

  it('rejects claims whose permissions are not all strings', () => {
    const malformed = signRaw({
      ...payload,
      permissions: ['employee.view', 42],
      type: 'access',
      jti: 'x',
    });

    expect(() => verifyAccessToken(malformed)).toThrow(ApiError);
  });

  it('reports a positive remaining lifetime', () => {
    const seconds = accessTokenExpiresInSeconds(signAccessToken(payload));
    expect(seconds).toBeGreaterThan(0);
    expect(seconds).toBeLessThanOrEqual(15 * 60);
  });
});
