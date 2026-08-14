import type { Organization } from '@prisma/client';
import { ApiError } from '../utils/api-error';
import {
  assertSameOrganization,
  canAccessAllOrganizations,
  organizationScope,
  slugify,
} from '../utils/tenant';
import type { AuthenticatedUser } from '../users/user.types';
import * as organizationRepository from './organization.repository';
import type { OrganizationWithCounts } from './organization.repository';
import type {
  CreateOrganizationInput,
  ListOrganizationsQuery,
  UpdateOrganizationInput,
} from './organization.validation';

/**
 * Resolves a unique slug for a new organization.
 *
 * An explicitly supplied slug must be free — silently renaming it would break
 * whatever the caller intended to link to. A derived one gets a counter.
 */
export async function resolveSlug(name: string, requested?: string): Promise<string> {
  if (requested) {
    const taken = await organizationRepository.findBySlug(requested);
    if (taken) throw ApiError.conflict(`The slug "${requested}" is already taken`);
    return requested;
  }

  return organizationRepository.findAvailableSlug(slugify(name));
}

export async function listOrganizations(
  user: AuthenticatedUser,
  query: ListOrganizationsQuery,
): Promise<{
  organizations: OrganizationWithCounts[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}> {
  // A tenant-confined caller sees exactly one row: their own organization.
  const scope = organizationScope(user);

  const { organizations, total } = await organizationRepository.list({
    skip: (query.page - 1) * query.limit,
    take: query.limit,
    search: query.search,
    organizationId: scope.organizationId,
  });

  return {
    organizations,
    total,
    page: query.page,
    limit: query.limit,
    totalPages: Math.max(1, Math.ceil(total / query.limit)),
  };
}

export async function getOrganizationById(
  user: AuthenticatedUser,
  id: string,
): Promise<OrganizationWithCounts> {
  const organization = await organizationRepository.findById(id);
  if (!organization) throw ApiError.notFound('Organization not found');

  // 404, not 403 — see assertSameOrganization.
  assertSameOrganization(user, organization.id, 'Organization');

  return organization;
}

/**
 * Creating an organization from the API is a platform operation: it makes a
 * tenant the creator does not belong to. Self-serve tenants are created through
 * registration instead.
 */
export async function createOrganization(
  input: CreateOrganizationInput,
): Promise<Organization> {
  const slug = await resolveSlug(input.name, input.slug);

  return organizationRepository.create({
    name: input.name,
    slug,
    description: input.description,
  });
}

export async function updateOrganization(
  user: AuthenticatedUser,
  id: string,
  input: UpdateOrganizationInput,
): Promise<OrganizationWithCounts> {
  await getOrganizationById(user, id);

  // Deactivation blocks sign-in for every user in the tenant, including the
  // caller. Restricted to platform administrators so an org admin cannot lock
  // their own organization out with no route back in.
  if (input.isActive !== undefined && !canAccessAllOrganizations(user)) {
    throw ApiError.forbidden(
      'Changing an organization\'s active state requires organization.manage_all',
    );
  }

  return organizationRepository.update(id, input);
}

export async function deleteOrganization(user: AuthenticatedUser, id: string): Promise<void> {
  const organization = await getOrganizationById(user, id);

  // Deleting cascades to every user, session and role assignment in the tenant.
  // Requiring an empty organization makes that destruction deliberate.
  const users = await organizationRepository.countUsers(id);
  if (users > 0) {
    throw ApiError.conflict(
      `This organization still has ${users} user(s). Remove them before deleting it.`,
    );
  }

  if (organization.id === user.organizationId) {
    throw ApiError.forbidden('You cannot delete the organization you belong to');
  }

  await organizationRepository.remove(id);
}
