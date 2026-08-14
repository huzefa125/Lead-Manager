import { ApiError } from './api-error';
import { hasPermission } from './permissions';
import type { AuthenticatedUser } from '../users/user.types';

/**
 * Tenant isolation.
 *
 * Every query over tenant-owned data must be filtered by organization. The
 * helpers here are the single place that decision is made, so it cannot drift
 * between call sites.
 *
 * The rule: a caller sees only their own organization, unless they hold
 * `organization.manage_all`. Super Admin satisfies that through its `*` grant,
 * so platform administrators work across tenants without a special case in
 * the code.
 */

/** The capability that lifts tenant confinement. */
export const CROSS_TENANT_PERMISSION = 'organization.manage_all';

export function canAccessAllOrganizations(user: AuthenticatedUser): boolean {
  return hasPermission(user.permissions, CROSS_TENANT_PERMISSION);
}

/**
 * A Prisma `where` fragment confining a query to the caller's organization.
 *
 * Returns `{}` for a cross-tenant caller, which widens the query to every
 * organization — deliberate, and gated on the permission above.
 */
export function organizationScope(user: AuthenticatedUser): { organizationId?: string } {
  return canAccessAllOrganizations(user) ? {} : { organizationId: user.organizationId };
}

/**
 * Rejects an attempt to touch another tenant's data.
 *
 * Deliberately throws 404 rather than 403: confirming that a record exists in
 * an organization the caller cannot see is itself a disclosure. From outside
 * the tenant, the resource is indistinguishable from one that does not exist.
 */
export function assertSameOrganization(
  user: AuthenticatedUser,
  resourceOrganizationId: string,
  resourceLabel = 'Resource',
): void {
  if (canAccessAllOrganizations(user)) return;
  if (user.organizationId === resourceOrganizationId) return;

  throw ApiError.notFound(`${resourceLabel} not found`);
}

/**
 * Builds a URL-safe slug from an organization name.
 *
 * Collisions are resolved by the caller (see `organization.service.ts`) — the
 * unique index on `slug` is the real guarantee.
 */
export function slugify(value: string): string {
  const slug = value
    .normalize('NFKD')
    // Strip diacritics so "Café" and "Cafe" produce the same slug.
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
    .replace(/-+$/g, '');

  // A name of only punctuation would slugify to an empty string, which the
  // unique index would then collapse across organizations.
  return slug.length > 0 ? slug : 'org';
}
