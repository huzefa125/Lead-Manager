import type { CookieOptions, Request, Response } from 'express';
import { env } from '../config/env';

/**
 * The refresh token is also set as an httpOnly cookie so browser clients never
 * have to touch it from JavaScript (an XSS payload cannot read it).
 *
 * `sameSite: 'strict'` is safe here because the cookie is only ever sent to the
 * refresh and logout endpoints, which are POSTs the app itself initiates.
 * A cross-site frontend on another domain needs `sameSite: 'none'` + `secure`.
 */
function cookieOptions(expiresAt: Date): CookieOptions {
  return {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: 'strict',
    path: '/api/auth',
    expires: expiresAt,
    ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
  };
}

export function setRefreshCookie(res: Response, token: string, expiresAt: Date): void {
  res.cookie(env.REFRESH_COOKIE_NAME, token, cookieOptions(expiresAt));
}

export function clearRefreshCookie(res: Response): void {
  res.clearCookie(env.REFRESH_COOKIE_NAME, {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: 'strict',
    path: '/api/auth',
    ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
  });
}

/**
 * Cookie first, body second. Browsers get the safer path automatically while
 * mobile and server-to-server clients can still pass the token explicitly.
 */
export function readRefreshToken(req: Request, bodyToken?: string): string | undefined {
  const cookies = req.cookies as Record<string, unknown> | undefined;
  const fromCookie = cookies?.[env.REFRESH_COOKIE_NAME];
  if (typeof fromCookie === 'string' && fromCookie.length > 0) return fromCookie;
  return bodyToken && bodyToken.length > 0 ? bodyToken : undefined;
}
