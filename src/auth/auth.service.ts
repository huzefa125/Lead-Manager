import { ApiError, ErrorCode } from '../utils/api-error';
import { burnPasswordTiming, verifyPassword } from '../utils/password';
import * as userService from '../users/user.service';
import { toPublicUser } from '../users/user.serializer';
import type { PublicUser } from '../users/user.types';
import * as tokenService from './token.service';
import type { IssuedTokens, RequestContext } from './token.service';
import type { LoginInput, RegisterInput } from './auth.validation';

export interface AuthResult {
  user: PublicUser;
  tokens: IssuedTokens;
}

/** New account → hashed password, then an immediate session. */
export async function register(
  input: RegisterInput,
  context: RequestContext,
): Promise<AuthResult> {
  const user = await userService.createUserWithPassword({
    email: input.email,
    password: input.password,
    name: input.name,
    organizationName: input.organizationName,
  });

  const tokens = await tokenService.issueTokens(user, context);
  return { user: toPublicUser(user), tokens };
}

export async function login(input: LoginInput, context: RequestContext): Promise<AuthResult> {
  const user = await userService.getUserByEmail(input.email);

  if (!user) {
    // Spend the same time bcrypt would have spent on a real hash, so account
    // existence cannot be inferred from how fast the request fails.
    await burnPasswordTiming(input.password);
    throw ApiError.invalidCredentials();
  }

  if (!(await verifyPassword(input.password, user.passwordHash))) {
    throw ApiError.invalidCredentials();
  }

  // Checked after the password, so a disabled account is not revealed to
  // someone who does not already hold valid credentials.
  if (!user.isActive) {
    throw new ApiError(403, ErrorCode.ACCOUNT_DISABLED, 'This account has been disabled');
  }

  // Suspending a tenant must lock out every account in it, not just block new
  // ones — otherwise a deactivated organization keeps working until each user
  // happens to log out.
  if (user.organization && !user.organization.isActive) {
    throw new ApiError(
      403,
      ErrorCode.ACCOUNT_DISABLED,
      'This organization has been deactivated',
    );
  }

  const tokens = await tokenService.issueTokens(user, context);
  return { user: toPublicUser(user), tokens };
}

/**
 * Verifies the refresh token from the cookie against the database and, if it is
 * good, issues a new access token *and rotates the refresh token* — the
 * presented one is destroyed and replaced.
 *
 * Rotation means a refresh token is single-use. A stolen one is good for at
 * most one exchange, and stops working the moment the real client refreshes.
 * The replacement keeps the original expiry, so the 7-day ceiling still holds.
 *
 * This is also the one point in a session's life where the user row is re-read,
 * so a deactivated or deleted account loses access here at the latest.
 */
export async function refresh(
  presentedToken: string,
  context: RequestContext,
): Promise<AuthResult> {
  const stored = await tokenService.verifyRefreshToken(presentedToken);
  const user = await userService.getUserById(stored.userId);

  if (!user) {
    await tokenService.deleteAllSessions(stored.userId);
    throw ApiError.unauthorized('Invalid or expired refresh token', ErrorCode.TOKEN_INVALID);
  }

  if (!user.isActive) {
    await tokenService.deleteAllSessions(user.id);
    throw new ApiError(403, ErrorCode.ACCOUNT_DISABLED, 'This account has been disabled');
  }

  // Refresh is where a tenant suspension reaches an already signed-in user.
  if (user.organization && !user.organization.isActive) {
    await tokenService.deleteAllSessions(user.id);
    throw new ApiError(
      403,
      ErrorCode.ACCOUNT_DISABLED,
      'This organization has been deactivated',
    );
  }

  const tokens = await tokenService.rotateTokens(user, stored, context);
  return { user: toPublicUser(user), tokens };
}

/**
 * Deletes the refresh token row. Idempotent by design: a client clearing its
 * credentials must always be able to finish, even with a stale token.
 */
export async function logout(presentedToken: string | undefined): Promise<void> {
  if (!presentedToken) return;

  try {
    const stored = await tokenService.verifyRefreshToken(presentedToken);
    await tokenService.deleteSession(stored.id);
  } catch {
    // Already invalid or gone — the caller's goal is met either way.
  }
}

/** Deletes every session for the user. */
export async function logoutAll(userId: string): Promise<number> {
  return tokenService.deleteAllSessions(userId);
}

export async function getCurrentUser(userId: string): Promise<PublicUser> {
  const user = await userService.getUserByIdOrFail(userId);
  return toPublicUser(user);
}
