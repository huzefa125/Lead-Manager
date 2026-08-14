import { ACTION_SEPARATOR, WILDCARD } from '../rbac/permission.constants';

/**
 * The whole of the authorization decision, in one pure function.
 *
 * A granted action satisfies a required action when it is:
 *   - the global wildcard `*`                    → grants everything
 *   - a resource wildcard `employee.*`           → grants every operation on employees
 *   - an exact match `employee.create`
 *
 * Nothing here knows the names of any resources or operations, which is what
 * makes the system dynamic: inserting a `invoice.approve` permission row and
 * granting it to a role is immediately enforceable with no code change.
 */
export function matchesPermission(granted: string, required: string): boolean {
  if (granted === WILDCARD) return true;
  if (granted === required) return true;

  // `employee.*` covers `employee.<anything>`.
  const separator = granted.lastIndexOf(ACTION_SEPARATOR);
  if (separator > 0 && granted.slice(separator + 1) === WILDCARD) {
    const grantedResource = granted.slice(0, separator);
    const requiredResource = required.slice(0, required.lastIndexOf(ACTION_SEPARATOR));
    return grantedResource === requiredResource;
  }

  return false;
}

/** True when any granted action satisfies the required one. */
export function hasPermission(granted: readonly string[], required: string): boolean {
  return granted.some((entry) => matchesPermission(entry, required));
}

/** True when the holder satisfies at least one of `required` (OR semantics). */
export function hasAnyPermission(
  granted: readonly string[],
  required: readonly string[],
): boolean {
  return required.some((entry) => hasPermission(granted, entry));
}

/** True when the holder satisfies every entry in `required` (AND semantics). */
export function hasAllPermissions(
  granted: readonly string[],
  required: readonly string[],
): boolean {
  return required.every((entry) => hasPermission(granted, entry));
}

/** The subset of `required` the holder is missing — used for error messages. */
export function missingPermissions(
  granted: readonly string[],
  required: readonly string[],
): string[] {
  return required.filter((entry) => !hasPermission(granted, entry));
}

/**
 * Splits `employee.create` into its halves. Returns null for a malformed
 * action, so callers can reject it rather than storing something unmatchable.
 */
export function parseAction(action: string): { resource: string; operation: string } | null {
  if (action === WILDCARD) return { resource: WILDCARD, operation: WILDCARD };

  const separator = action.lastIndexOf(ACTION_SEPARATOR);
  if (separator <= 0 || separator === action.length - 1) return null;

  return {
    resource: action.slice(0, separator),
    operation: action.slice(separator + 1),
  };
}
