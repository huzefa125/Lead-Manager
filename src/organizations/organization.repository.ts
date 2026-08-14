import type { Organization, Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';

/** All Organization table access. */

export type OrganizationWithCounts = Organization & {
  _count: { users: number };
};

const withCounts = { _count: { select: { users: true } } } satisfies Prisma.OrganizationInclude;

export async function findById(id: string): Promise<OrganizationWithCounts | null> {
  return prisma.organization.findUnique({ where: { id }, include: withCounts });
}

export async function findBySlug(slug: string): Promise<Organization | null> {
  return prisma.organization.findUnique({ where: { slug } });
}

/**
 * Finds the first free slug of the form `base`, `base-2`, `base-3`, …
 *
 * Advisory only — the unique index remains the real guarantee, and a losing
 * race surfaces as a P2002, which the error handler maps to 409.
 */
export async function findAvailableSlug(base: string): Promise<string> {
  const taken = await prisma.organization.findMany({
    where: { slug: { startsWith: base } },
    select: { slug: true },
  });

  const used = new Set(taken.map((row) => row.slug));
  if (!used.has(base)) return base;

  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!used.has(candidate)) return candidate;
  }

  // Astronomically unlikely; falls back to a value the unique index will accept.
  return `${base}-${Date.now()}`;
}

export interface ListOptions {
  skip: number;
  take: number;
  search?: string | undefined;
  /** Confines the query to one organization for a non-cross-tenant caller. */
  organizationId?: string | undefined;
}

export async function list(
  options: ListOptions,
): Promise<{ organizations: OrganizationWithCounts[]; total: number }> {
  const where: Prisma.OrganizationWhereInput = {
    ...(options.organizationId ? { id: options.organizationId } : {}),
    ...(options.search
      ? {
          OR: [
            { name: { contains: options.search, mode: 'insensitive' } },
            { slug: { contains: options.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const [organizations, total] = await prisma.$transaction([
    prisma.organization.findMany({
      where,
      include: withCounts,
      orderBy: { name: 'asc' },
      skip: options.skip,
      take: options.take,
    }),
    prisma.organization.count({ where }),
  ]);

  return { organizations, total };
}

export async function create(input: {
  name: string;
  slug: string;
  description?: string | undefined;
}): Promise<Organization> {
  return prisma.organization.create({
    data: {
      name: input.name,
      slug: input.slug,
      description: input.description ?? null,
    },
  });
}

export async function update(
  id: string,
  data: {
    name?: string | undefined;
    description?: string | null | undefined;
    isActive?: boolean | undefined;
  },
): Promise<OrganizationWithCounts> {
  return prisma.organization.update({
    where: { id },
    data: {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.description !== undefined ? { description: data.description } : {}),
      ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
    },
    include: withCounts,
  });
}

/** Users (and their sessions and role assignments) cascade from the schema. */
export async function remove(id: string): Promise<void> {
  await prisma.organization.delete({ where: { id } });
}

export async function countUsers(id: string): Promise<number> {
  return prisma.user.count({ where: { organizationId: id } });
}

/**
 * Creates an organization and its first user in one transaction.
 *
 * Self-serve registration must not be able to leave an orphan organization
 * behind if the user insert fails.
 */
export async function createWithOwner(input: {
  organization: { name: string; slug: string };
  user: { email: string; passwordHash: string; name?: string | undefined };
  roleIds: string[];
}): Promise<{ organizationId: string; userId: string }> {
  return prisma.$transaction(async (tx) => {
    const organization = await tx.organization.create({
      data: { name: input.organization.name, slug: input.organization.slug },
    });

    const user = await tx.user.create({
      data: {
        email: input.user.email,
        passwordHash: input.user.passwordHash,
        ...(input.user.name !== undefined ? { name: input.user.name } : {}),
        organizationId: organization.id,
        roles: { create: input.roleIds.map((roleId) => ({ roleId })) },
      },
    });

    return { organizationId: organization.id, userId: user.id };
  });
}
