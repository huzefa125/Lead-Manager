import type { NextFunction, Request, Response } from 'express';
import { ApiError } from '../utils/api-error';
import { verifyAccessToken } from '../utils/jwt';

/**
 * Pulls a bearer token out of the Authorization header.
 * The scheme match is case-insensitive per RFC 7235.
 */
function extractBearerToken(req: Request): string | null {
  const header = req.get('authorization');
  if (!header) return null;

  const [scheme, ...rest] = header.split(' ');
  if (!scheme || scheme.toLowerCase() !== 'bearer') return null;

  const token = rest.join(' ').trim();
  return token.length > 0 ? token : null;
}

/**
 * Route protection — verification happens entirely in memory.
 *
 * The access token is a signed JWT, so its signature, expiry, issuer and
 * audience are all checked against the secret key with zero database round
 * trips. `req.user` is built from the token's own claims; nothing here reads
 * Postgres, which is what keeps protected routes cheap under load.
 *
 * The tradeoff this buys, stated plainly: a user deactivated or deleted
 * mid-session keeps access until their token expires. That window is bounded by
 * ACCESS_TOKEN_TTL (15m by default) and closes at the next /refresh, which does
 * hit the database. Shorten the TTL if the window needs to be tighter.
 */
export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  try {
    const token = extractBearerToken(req);
    if (!token) {
      throw ApiError.unauthorized('Authentication required — provide a Bearer access token');
    }

    const claims = verifyAccessToken(token);

    req.user = {
      id: claims.sub,
      email: claims.email,
      organizationId: claims.org,
      roles: claims.roles,
      permissions: claims.permissions,
      tokenId: claims.jti,
    };

    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Attaches `req.user` when a valid token is present but never rejects.
 * For endpoints that vary their response for signed-in users.
 */
export function optionalAuthenticate(req: Request, res: Response, next: NextFunction): void {
  if (!req.get('authorization')) {
    next();
    return;
  }

  authenticate(req, res, (error?: unknown) => {
    // A bad token on an optional route just means "not signed in".
    next(error instanceof ApiError && error.statusCode === 401 ? undefined : error);
  });
}
