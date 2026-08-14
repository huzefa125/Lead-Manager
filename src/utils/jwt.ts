import crypto from 'node:crypto';
import jwt, { type SignOptions } from 'jsonwebtoken';
import { env } from '../config/env';
import { ApiError, ErrorCode } from './api-error';

/**
 * Claims carried by an access token.
 *
 * `roles` and `permissions` are the user's effective grants, resolved from the
 * database at sign-in and frozen into the signed token. This is what lets
 * `authorize()` decide without a query — the claims are tamper-proof because
 * altering them invalidates the signature.
 *
 * The cost is propagation delay: a permission change reaches a signed-in user
 * at their next refresh, so within ACCESS_TOKEN_TTL (15m). Role changes made
 * through the RBAC API delete the affected user's sessions to close that
 * window — see `user-role.service.ts`.
 */
export interface AccessTokenClaims {
  sub: string;
  email: string;
  /** Role names, e.g. `['admin']`. For display and `requireRole()`. */
  roles: string[];
  /** Effective permission actions, wildcards included, e.g. `['employee.*']`. */
  permissions: string[];
  type: 'access';
  jti: string;
}

/** Everything the JWT library adds on top of our own claims. */
export type VerifiedAccessToken = AccessTokenClaims & {
  iat: number;
  exp: number;
  iss?: string;
  aud?: string | string[];
};

export function signAccessToken(payload: Omit<AccessTokenClaims, 'type' | 'jti'>): string {
  const claims: AccessTokenClaims = {
    ...payload,
    type: 'access',
    jti: crypto.randomUUID(),
  };

  const options: SignOptions = {
    expiresIn: env.ACCESS_TOKEN_TTL as SignOptions['expiresIn'],
    issuer: env.JWT_ISSUER,
    audience: env.JWT_AUDIENCE,
    algorithm: 'HS256',
  };

  return jwt.sign(claims, env.JWT_ACCESS_SECRET, options);
}

/**
 * Verifies signature, expiry, issuer and audience, then checks the payload
 * really is an access token. Throws an ApiError so callers never have to know
 * about jsonwebtoken's error classes.
 */
export function verifyAccessToken(token: string): VerifiedAccessToken {
  let decoded: unknown;

  try {
    decoded = jwt.verify(token, env.JWT_ACCESS_SECRET, {
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
      algorithms: ['HS256'],
    });
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw ApiError.unauthorized('Access token has expired', ErrorCode.TOKEN_EXPIRED);
    }
    throw ApiError.unauthorized('Invalid access token', ErrorCode.TOKEN_INVALID);
  }

  if (!isAccessTokenClaims(decoded)) {
    throw ApiError.unauthorized('Malformed access token', ErrorCode.TOKEN_INVALID);
  }

  return decoded;
}

/**
 * Guards against a token of the wrong shape or kind being accepted — e.g. a
 * token minted for a different purpose that happens to share the secret.
 */
function isAccessTokenClaims(value: unknown): value is VerifiedAccessToken {
  if (typeof value !== 'object' || value === null) return false;
  const claims = value as Record<string, unknown>;
  return (
    claims.type === 'access' &&
    typeof claims.sub === 'string' &&
    typeof claims.email === 'string' &&
    // Tokens issued before RBAC carry a `role` string instead of these arrays.
    // Rejecting them means those users re-authenticate once, rather than being
    // admitted with no permissions and hitting confusing 403s.
    isStringArray(claims.roles) &&
    isStringArray(claims.permissions) &&
    typeof claims.jti === 'string' &&
    typeof claims.iat === 'number' &&
    typeof claims.exp === 'number'
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

/** Seconds until the access token expires — handy for clients scheduling refresh. */
export function accessTokenExpiresInSeconds(token: string): number {
  const decoded = jwt.decode(token);
  if (decoded && typeof decoded === 'object' && typeof decoded.exp === 'number') {
    return Math.max(0, decoded.exp - Math.floor(Date.now() / 1000));
  }
  return 0;
}
