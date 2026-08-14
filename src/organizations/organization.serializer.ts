import type { Organization } from '@prisma/client';
import type { OrganizationWithCounts } from './organization.repository';

export interface PublicOrganization {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  isActive: boolean;
  userCount?: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Compact form embedded in a user payload. */
export interface OrganizationSummary {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
}

export function toPublicOrganization(
  organization: Organization | OrganizationWithCounts,
): PublicOrganization {
  return {
    id: organization.id,
    name: organization.name,
    slug: organization.slug,
    description: organization.description,
    isActive: organization.isActive,
    ...('_count' in organization ? { userCount: organization._count.users } : {}),
    createdAt: organization.createdAt,
    updatedAt: organization.updatedAt,
  };
}

export function toPublicOrganizations(
  organizations: (Organization | OrganizationWithCounts)[],
): PublicOrganization[] {
  return organizations.map(toPublicOrganization);
}

export function toOrganizationSummary(organization: Organization): OrganizationSummary {
  return {
    id: organization.id,
    name: organization.name,
    slug: organization.slug,
    isActive: organization.isActive,
  };
}
