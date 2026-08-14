import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import {
  PERMISSION_CATALOGUE,
  ROLE_CATALOGUE,
  SystemRole,
} from '../src/rbac/permission.constants';

const prisma = new PrismaClient();

/**
 * Idempotent seed. Safe to re-run after adding a module to the catalogue: it
 * upserts rather than recreating, so existing ids, custom roles and manual
 * grants survive.
 */

/**
 * Two tenants on purpose: with everyone in one organization, a broken tenant
 * filter would still look correct.
 */
const SEED_ORGANIZATIONS = [
  {
    slug: 'platform',
    name: 'Platform',
    description: 'Home tenant for platform administrators.',
  },
  {
    slug: 'acme',
    name: 'Acme Corporation',
    description: 'Demo customer tenant.',
  },
  {
    slug: 'globex',
    name: 'Globex Industries',
    description: 'Second demo tenant — used to prove data does not leak across organizations.',
  },
];

const SEED_USERS = [
  {
    email: 'superadmin@example.com',
    name: 'Super Admin',
    password: 'SuperAdmin123!',
    organization: 'platform',
    roles: [SystemRole.SUPER_ADMIN],
  },
  {
    email: 'admin@example.com',
    name: 'Admin User',
    password: 'Admin123!',
    organization: 'acme',
    roles: [SystemRole.ADMIN],
  },
  {
    email: 'manager@example.com',
    name: 'Manager User',
    password: 'Manager123!',
    organization: 'acme',
    roles: ['manager'],
  },
  {
    email: 'user@example.com',
    name: 'Regular User',
    password: 'User1234!',
    organization: 'acme',
    roles: [SystemRole.USER],
  },
  {
    email: 'globex.admin@example.com',
    name: 'Globex Admin',
    password: 'Globex123!',
    organization: 'globex',
    roles: [SystemRole.ADMIN],
  },
];

async function seedPermissions(): Promise<Map<string, string>> {
  const byAction = new Map<string, string>();

  for (const entry of PERMISSION_CATALOGUE) {
    const permission = await prisma.permission.upsert({
      where: { action: entry.action },
      // Only the description is refreshed — resource/operation are derived from
      // the action and must not drift.
      update: { description: entry.description, isSystem: true },
      create: {
        action: entry.action,
        resource: entry.resource,
        operation: entry.operation,
        description: entry.description,
        isSystem: true,
      },
    });
    byAction.set(permission.action, permission.id);
  }

  console.log(`  permissions: ${byAction.size} upserted`);
  return byAction;
}

async function seedRoles(permissionIds: Map<string, string>): Promise<Map<string, string>> {
  const byName = new Map<string, string>();

  for (const entry of ROLE_CATALOGUE) {
    const role = await prisma.role.upsert({
      where: { name: entry.name },
      update: { displayName: entry.displayName, description: entry.description, isSystem: true },
      create: {
        name: entry.name,
        displayName: entry.displayName,
        description: entry.description,
        isSystem: true,
      },
    });

    const ids = entry.permissions
      .map((action) => {
        const id = permissionIds.get(action);
        if (!id) console.warn(`  ! unknown permission "${action}" on role "${entry.name}"`);
        return id;
      })
      .filter((id): id is string => Boolean(id));

    // Replace the grant set in one transaction so the role is never observed
    // mid-update with a partial set of permissions.
    await prisma.$transaction([
      prisma.rolePermission.deleteMany({ where: { roleId: role.id } }),
      prisma.rolePermission.createMany({
        data: ids.map((permissionId) => ({ roleId: role.id, permissionId })),
        skipDuplicates: true,
      }),
    ]);

    byName.set(role.name, role.id);
    console.log(`  role ${role.name.padEnd(12)} → ${ids.length} permission(s)`);
  }

  return byName;
}

async function seedOrganizations(): Promise<Map<string, string>> {
  const bySlug = new Map<string, string>();

  for (const entry of SEED_ORGANIZATIONS) {
    const organization = await prisma.organization.upsert({
      where: { slug: entry.slug },
      update: { name: entry.name, description: entry.description },
      create: { slug: entry.slug, name: entry.name, description: entry.description },
    });
    bySlug.set(organization.slug, organization.id);
    console.log(`  organization ${organization.slug.padEnd(10)} ${organization.name}`);
  }

  return bySlug;
}

async function seedUsers(
  roleIds: Map<string, string>,
  organizationIds: Map<string, string>,
): Promise<void> {
  for (const seed of SEED_USERS) {
    const passwordHash = await bcrypt.hash(seed.password, 12);

    const organizationId = organizationIds.get(seed.organization);
    if (!organizationId) {
      throw new Error(`Seed organization "${seed.organization}" was not created`);
    }

    const user = await prisma.user.upsert({
      where: { email: seed.email },
      // Existing accounts keep their password; only their tenant is corrected,
      // so re-running the seed after the organizations migration re-homes the
      // accounts that were parked in "Default Organization".
      update: { organizationId },
      create: { email: seed.email, name: seed.name, passwordHash, organizationId },
    });

    const ids = seed.roles
      .map((name) => roleIds.get(name))
      .filter((id): id is string => Boolean(id));

    await prisma.$transaction([
      prisma.userRole.deleteMany({ where: { userId: user.id } }),
      prisma.userRole.createMany({
        data: ids.map((roleId) => ({ userId: user.id, roleId })),
        skipDuplicates: true,
      }),
    ]);

    console.log(
      `  ${user.email.padEnd(26)} ${seed.organization.padEnd(9)} ${seed.roles.join(', ').padEnd(12)} password: ${seed.password}`,
    );
  }
}

async function main(): Promise<void> {
  if (process.env['NODE_ENV'] === 'production') {
    throw new Error('Refusing to seed a production database');
  }

  console.log('Seeding organizations...');
  const organizationIds = await seedOrganizations();

  console.log('Seeding RBAC...');
  const permissionIds = await seedPermissions();
  const roleIds = await seedRoles(permissionIds);

  console.log('Seeding users...');
  await seedUsers(roleIds, organizationIds);

  console.log('\nDone. Super Admin holds "*" — it covers modules added later with no reseed.');
  console.log('Only Super Admin has organization.manage_all, so every other account is');
  console.log('confined to its own tenant.');
}

main()
  .catch((error: unknown) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
