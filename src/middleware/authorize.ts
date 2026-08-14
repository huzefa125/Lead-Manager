import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ApiError, ErrorCode } from '../utils/api-error';
import { hasAllPermissions, hasAnyPermission, missingPermissions } from '../utils/permissions';

/**
 * Permission gate for a route.
 *
 *   router.post('/employees', authenticate, authorize('employee.create'), controller)
 *
 * Reads the permissions carried by the verified access token, so the check is
 * pure in-memory work — no database query, matching the authentication design.
 *
 * With several permissions the semantics are OR (any one suffices), which is
 * the common case. Use `authorizeAll` when every permission must be held.
 *
 * Returns 403 when the user is authenticated but lacks the permission, and 401
 * when there is no authenticated user at all — the distinction matters to
 * clients deciding whether to re-authenticate or show an error.
 */
export function authorize(...required: string[]): RequestHandler {
  if (required.length === 0) {
    // A programming error: an unqualified gate would silently allow everyone.
    throw new Error('authorize() requires at least one permission');
  }

  return (req: Request, _res: Response, next: NextFunction): void => {
    const user = req.user;

    if (!user) {
      next(
        ApiError.unauthorized(
          'Authentication required — authorize() must run after authenticate()',
        ),
      );
      return;
    }

    if (hasAnyPermission(user.permissions, required)) {
      next();
      return;
    }

    next(forbidden(required));
  };
}

/** As `authorize`, but every listed permission must be held (AND semantics). */
export function authorizeAll(...required: string[]): RequestHandler {
  if (required.length === 0) {
    throw new Error('authorizeAll() requires at least one permission');
  }

  return (req: Request, _res: Response, next: NextFunction): void => {
    const user = req.user;

    if (!user) {
      next(ApiError.unauthorized('Authentication required'));
      return;
    }

    if (hasAllPermissions(user.permissions, required)) {
      next();
      return;
    }

    next(forbidden(missingPermissions(user.permissions, required)));
  };
}

/**
 * Gate on role membership rather than permission.
 *
 * Prefer `authorize()`: permissions survive reorganisation of roles, whereas a
 * role check hard-codes today's structure. This exists for the rare case where
 * the role itself is the thing that matters.
 */
export function requireRole(...roles: string[]): RequestHandler {
  if (roles.length === 0) {
    throw new Error('requireRole() requires at least one role');
  }

  return (req: Request, _res: Response, next: NextFunction): void => {
    const user = req.user;

    if (!user) {
      next(ApiError.unauthorized('Authentication required'));
      return;
    }

    if (roles.some((role) => user.roles.includes(role))) {
      next();
      return;
    }

    next(
      new ApiError(
        403,
        ErrorCode.FORBIDDEN,
        `This action requires one of the following roles: ${roles.join(', ')}`,
      ),
    );
  };
}

/**
 * Names the missing permission in the response.
 *
 * This is deliberate: the caller is already authenticated, and telling an admin
 * exactly which permission to grant is worth far more than the negligible
 * information disclosure of a permission name they already failed to use.
 */
function forbidden(required: readonly string[]): ApiError {
  const list = required.join(', ');
  return new ApiError(
    403,
    ErrorCode.FORBIDDEN,
    required.length === 1
      ? `You do not have permission to perform this action. Required: ${list}`
      : `You do not have permission to perform this action. Required one of: ${list}`,
  );
}
