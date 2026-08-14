import type { Request, Response } from 'express';
import { ApiError, ErrorCode } from '../utils/api-error';
import { sendSuccess } from '../utils/api-response';
import * as authService from './auth.service';
import type { AuthResult } from './auth.service';
import { clearRefreshCookie, readRefreshToken, setRefreshCookie } from './auth.cookies';
import type { RequestContext } from './token.service';
import type { LoginInput, LogoutInput, RefreshInput, RegisterInput } from './auth.validation';

/** Session metadata recorded against each refresh token, for auditing. */
function requestContext(req: Request): RequestContext {
  return {
    userAgent: req.get('user-agent')?.slice(0, 512),
    ipAddress: req.ip,
  };
}

/**
 * Sends the access token in the response body and the refresh token *only* as
 * an httpOnly cookie.
 *
 * The split is deliberate: the frontend keeps the access token in memory (JS
 * state, never localStorage) and never sees the refresh token at all, so an XSS
 * payload can steal at most 15 minutes of access rather than a 7-day session.
 */
function respondWithSession(res: Response, result: AuthResult, statusCode: number): void {
  setRefreshCookie(res, result.tokens.refreshToken, result.tokens.refreshTokenExpiresAt);

  sendSuccess(
    res,
    {
      user: result.user,
      accessToken: result.tokens.accessToken,
      tokenType: result.tokens.tokenType,
      expiresIn: result.tokens.expiresIn,
    },
    statusCode,
  );
}

/** POST /api/auth/register */
export async function register(req: Request, res: Response): Promise<void> {
  const input = req.body as RegisterInput;
  const result = await authService.register(input, requestContext(req));
  respondWithSession(res, result, 201);
}

/** POST /api/auth/login */
export async function login(req: Request, res: Response): Promise<void> {
  const input = req.body as LoginInput;
  const result = await authService.login(input, requestContext(req));
  respondWithSession(res, result, 200);
}

/**
 * POST /api/auth/refresh
 *
 * Reads the refresh token from the cookie, validates it against the database,
 * then returns a fresh access token and rotates the refresh token — the old one
 * is destroyed, so it is single-use.
 *
 * No Authorization header required: this is the endpoint a client calls
 * precisely because its access token has expired.
 */
export async function refresh(req: Request, res: Response): Promise<void> {
  const input = req.body as RefreshInput;
  const token = readRefreshToken(req, input.refreshToken);

  if (!token) {
    throw ApiError.unauthorized('Refresh token is required', ErrorCode.TOKEN_INVALID);
  }

  try {
    // Rotation issues a new refresh token, so the cookie is replaced too.
    const result = await authService.refresh(token, requestContext(req));
    respondWithSession(res, result, 200);
  } catch (error) {
    // The token is not usable; stop the browser from replaying it.
    clearRefreshCookie(res);
    throw error;
  }
}

/** POST /api/auth/logout — deletes this session's refresh token and clears the cookie. */
export async function logout(req: Request, res: Response): Promise<void> {
  const input = req.body as LogoutInput;
  const token = readRefreshToken(req, input.refreshToken);

  await authService.logout(token);
  clearRefreshCookie(res);

  sendSuccess(res, { message: 'Logged out successfully' });
}

/** POST /api/auth/logout-all — deletes every session for the current user. */
export async function logoutAll(req: Request, res: Response): Promise<void> {
  // `authenticate` guarantees req.user; the check satisfies strict null checks
  // without a non-null assertion.
  if (!req.user) throw ApiError.unauthorized();

  const revokedCount = await authService.logoutAll(req.user.id);
  clearRefreshCookie(res);

  sendSuccess(res, { message: 'All sessions revoked', revokedCount });
}

/**
 * GET /api/auth/me — the protected endpoint.
 *
 * `authenticate` has already authorized this request from the token alone. The
 * database read here is for the response payload (name, timestamps, current
 * role), not for authorization.
 */
export async function me(req: Request, res: Response): Promise<void> {
  if (!req.user) throw ApiError.unauthorized();

  const user = await authService.getCurrentUser(req.user.id);
  sendSuccess(res, { user });
}
