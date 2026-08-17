/**
 * A mirror of the server's `src/utils/permissions.ts`.
 *
 * This is presentation only — it decides whether to render a button, never
 * whether an action is allowed. Every route the button calls is authorized
 * again on the server, so a user who edits this in devtools gains a disabled
 * form and a 403.
 */

const WILDCARD = '*'
const SEPARATOR = '.'

export function matchesPermission(granted: string, required: string): boolean {
  if (granted === WILDCARD) return true
  if (granted === required) return true

  const separator = granted.lastIndexOf(SEPARATOR)
  if (separator > 0 && granted.slice(separator + 1) === WILDCARD) {
    return granted.slice(0, separator) === required.slice(0, required.lastIndexOf(SEPARATOR))
  }

  return false
}

export function hasPermission(granted: readonly string[], required: string): boolean {
  return granted.some((entry) => matchesPermission(entry, required))
}

export function hasAnyPermission(
  granted: readonly string[],
  required: readonly string[],
): boolean {
  return required.some((entry) => hasPermission(granted, entry))
}

/** The action strings this UI gates on, so they are never hand-typed. */
export const Permissions = {
  LEAD_VIEW: 'lead.view',
  LEAD_CREATE: 'lead.create',
  LEAD_UPDATE: 'lead.update',
  LEAD_DELETE: 'lead.delete',
  LEAD_ASSIGN: 'lead.assign',
  LEAD_CAPTURE: 'lead.capture',

  LEAD_SOURCE_VIEW: 'lead_source.view',
  LEAD_SOURCE_CREATE: 'lead_source.create',
  LEAD_SOURCE_UPDATE: 'lead_source.update',
  LEAD_SOURCE_DELETE: 'lead_source.delete',

  LEAD_STAGE_VIEW: 'lead_stage.view',
  LEAD_STAGE_CREATE: 'lead_stage.create',
  LEAD_STAGE_UPDATE: 'lead_stage.update',
  LEAD_STAGE_DELETE: 'lead_stage.delete',

  USER_VIEW: 'user.view',
  ROLE_VIEW: 'role.view',
  ROLE_CREATE: 'role.create',
  ROLE_UPDATE: 'role.update',
  ROLE_DELETE: 'role.delete',
  ROLE_ASSIGN: 'role.assign',
  PERMISSION_VIEW: 'permission.view',

  ORGANIZATION_VIEW: 'organization.view',
  ORGANIZATION_UPDATE: 'organization.update',
} as const
