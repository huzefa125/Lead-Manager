import type { RefreshToken } from '@prisma/client';
import { env } from '../config/env';
import { ApiError, ErrorCode } from '../utils/api-error';
import { generateOpaqueToken, parseOpaqueToken, sha256, timingSafeEqualHex } from '../utils/crypto';
import { accessTokenExpiresInSeconds, signAccessToken } from '../utils/jwt';
import { extractPermissions, extractRoleNames } from '../users/user.serializer';
import type { UserWithRoles } from '../users/user.types';
import * as tokenRepository from './token.repository';

export interface RequestContext {
  userAgent?: string | undefined;
  ipAddress?: string | undefined;
}

/** What the caller gets back. The refresh token leaves only via an httpOnly cookie. */
export interface IssuedTokens {
  accessToken: string;
  /** Seconds until `accessToken` expires. */
  expiresIn: number;
  tokenType: 'Bearer';
  refreshToken: string;
  refreshTokenExpiresAt: Date;
}

function refreshExpiryDate(): Date {
  return new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * Mints a short-lived JWT carrying the user's effective roles and permissions.
 *
 * Resolving grants here — once per token — is what allows `authorize()` to run
 * with no database access on every subsequent request. The claims are signed,
 * so a client cannot add a permission to its own token.
 */
export function buildAccessToken(user: UserWithRoles): string {
  return signAccessToken({
    sub: user.id,
    email: user.email,
    roles: extractRoleNames(user),
    permissions: extractPermissions(user),
  });
}

export function accessTokenResult(
  accessToken: string,
): Pick<IssuedTokens, 'accessToken' | 'expiresIn' | 'tokenType'> {
  return {
    accessToken,
    expiresIn: accessTokenExpiresInSeconds(accessToken),
    tokenType: 'Bearer',
  };
}

/** Issues an access token and opens a new refresh session in the database. */
export async function issueTokens(
  user: UserWithRoles,
  context: RequestContext,
): Promise<IssuedTokens> {
  const accessToken = buildAccessToken(user);
  const opaque = generateOpaqueToken();
  const expiresAt = refreshExpiryDate();

  await tokenRepository.createRefreshToken({
    id: opaque.id,
    userId: user.id,
    tokenHash: opaque.hash,
    expiresAt,
    userAgent: context.userAgent,
    ipAddress: context.ipAddress,
  });

  return {
    ...accessTokenResult(accessToken),
    refreshToken: opaque.token,
    refreshTokenExpiresAt: expiresAt,
  };
}

/**
 * Checks a presented refresh token against its stored row.
 *
 * Every failure returns the same generic 401, so a caller cannot distinguish
 * "no such token" from "expired" from "wrong secret".
 */
export async function verifyRefreshToken(presented: string): Promise<RefreshToken> {
  const invalid = (): never => {
    throw ApiError.unauthorized('Invalid or expired refresh token', ErrorCode.TOKEN_INVALID);
  };

  const parsed = parseOpaqueToken(presented);
  if (!parsed) return invalid();

  const stored = await tokenRepository.findRefreshTokenById(parsed.id);
  if (!stored) return invalid();

  // Constant-time so the comparison cannot be probed byte by byte.
  if (!timingSafeEqualHex(sha256(parsed.secret), stored.tokenHash)) return invalid();

  if (stored.expiresAt.getTime() <= Date.now()) {
    // Clean up as we go; the row can never be valid again.
    await tokenRepository.deleteRefreshToken(stored.id);
    return invalid();
  }

  return stored;
}

/**
 * Rotates a refresh token: the presented one is destroyed and a new one issued
 * alongside a fresh access token.
 *
 * Rotation makes every refresh token single-use, which bounds the value of a
 * stolen one — it works at most once, and only until the legitimate client next
 * refreshes, at which point the thief's copy is already gone from the database.
 *
 * The new token inherits the ORIGINAL expiry rather than extending it, so a
 * session cannot be kept alive forever by refreshing in a loop. After
 * REFRESH_TOKEN_TTL_DAYS the user must sign in again.
 *
 * Because the access token is rebuilt from the freshly loaded user, this is
 * also where permission changes reach an already signed-in client.
 */
export async function rotateTokens(
  user: UserWithRoles,
  current: RefreshToken,
  context: RequestContext,
): Promise<IssuedTokens> {
  const accessToken = buildAccessToken(user);
  const opaque = generateOpaqueToken();

  await tokenRepository.rotateRefreshToken(current.id, {
    id: opaque.id,
    userId: user.id,
    tokenHash: opaque.hash,
    expiresAt: current.expiresAt,
    userAgent: context.userAgent,
    ipAddress: context.ipAddress,
  });

  return {
    ...accessTokenResult(accessToken),
    refreshToken: opaque.token,
    refreshTokenExpiresAt: current.expiresAt,
  };
}

export async function deleteSession(tokenId: string): Promise<boolean> {
  return tokenRepository.deleteRefreshToken(tokenId);
}

export async function deleteAllSessions(userId: string): Promise<number> {
  return tokenRepository.deleteAllUserRefreshTokens(userId);
}
