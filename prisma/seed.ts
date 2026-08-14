import {
  LeadActivityDirection,
  LeadActivityType,
  LeadStatus,
  PrismaClient,
} from '@prisma/client';
import bcrypt from 'bcrypt';
import { DEFAULT_SOURCES, DEFAULT_STAGES } from '../src/leads/lead.constants';
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

/**
 * Provisions the default pipeline for every seeded tenant.
 *
 * Mirrors `ensureDefaults` in the lead repository — `skipDuplicates` against
 * the `(organization_id, key)` unique index makes both idempotent, so a tenant
 * that already has stages keeps its own naming and ordering.
 */
async function seedLeadPipeline(organizationIds: Map<string, string>): Promise<void> {
  for (const organizationId of organizationIds.values()) {
    await prisma.leadStage.createMany({
      data: DEFAULT_STAGES.map((stage) => ({ ...stage, organizationId, isSystem: true })),
      skipDuplicates: true,
    });
    await prisma.leadSource.createMany({
      data: DEFAULT_SOURCES.map((source) => ({ ...source, organizationId, isSystem: true })),
      skipDuplicates: true,
    });
  }

  console.log(
    `  ${DEFAULT_STAGES.length} stages + ${DEFAULT_SOURCES.length} sources per organization`,
  );
}

/**
 * The demo funnel.
 *
 * Deliberately shaped like a real one — 127 captured, 89 contacted, 54 replied,
 * 31 meetings, 18 quotations, 7 won — because a funnel where every lead
 * converts demonstrates nothing. The interesting number is the 35 leads that
 * are contacted and never reply, which is what `GET /api/leads/funnel` reports
 * as the biggest break in the journey.
 *
 * Milestone columns are written directly here rather than by replaying
 * activities: that is exactly what a CRM import does, and it exercises the same
 * path a customer's first day would.
 */
const DEMO_FUNNEL = { captured: 127, contacted: 89, replied: 54, meeting: 31, quotation: 18, won: 7 };

const DEMO_COMPANIES = [
  'Sharma Textiles', 'Vertex Logistics', 'Bluewave Media', 'Anand Motors', 'Kestrel Foods',
  'Nimbus Interiors', 'Patel Pharma', 'Orbit Realty', 'Sunrise Dairy', 'Kraft & Co',
  'Meridian Travel', 'Rathore Steel', 'Lotus Events', 'Pioneer Tech', 'Everest Packaging',
];

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

async function seedDemoLeads(
  organizationIds: Map<string, string>,
  ownerEmails: string[],
): Promise<void> {
  const organizationId = organizationIds.get('acme');
  if (!organizationId) throw new Error('Seed organization "acme" was not created');

  const [sources, stages, owners] = await Promise.all([
    prisma.leadSource.findMany({ where: { organizationId }, orderBy: { key: 'asc' } }),
    prisma.leadStage.findMany({ where: { organizationId } }),
    prisma.user.findMany({ where: { organizationId, email: { in: ownerEmails } } }),
  ]);

  const stageByKey = new Map(stages.map((stage) => [stage.key, stage]));
  const now = Date.now();
  let created = 0;

  for (let index = 0; index < DEMO_FUNNEL.captured; index += 1) {
    const source = sources[index % sources.length];
    if (!source) break;

    const externalId = `seed-${index}`;
    const existing = await prisma.lead.findUnique({
      where: { sourceId_externalId: { sourceId: source.id, externalId } },
      select: { id: true },
    });
    if (existing) continue;

    // Spread capture over the last 90 days, oldest first, so date filters and
    // the "stale leads" queue have something to show.
    const capturedAt = new Date(now - (90 - Math.floor((index * 89) / DEMO_FUNNEL.captured)) * DAY);

    const contacted = index < DEMO_FUNNEL.contacted;
    const replied = index < DEMO_FUNNEL.replied;
    const meeting = index < DEMO_FUNNEL.meeting;
    const quotation = index < DEMO_FUNNEL.quotation;
    const won = index < DEMO_FUNNEL.won;
    // A spread of losses at every depth — a funnel where leads only die at one
    // step would make the drop-off report look artificially clean.
    const lost = !won && index % 5 === 3;

    const firstContactAt = contacted ? new Date(capturedAt.getTime() + (2 + (index % 40)) * HOUR) : null;
    const firstReplyAt = replied && firstContactAt
      ? new Date(firstContactAt.getTime() + (3 + (index % 30)) * HOUR)
      : null;
    const meetingBookedAt = meeting && firstReplyAt
      ? new Date(firstReplyAt.getTime() + (1 + (index % 5)) * DAY)
      : null;
    const quotationSentAt = quotation && meetingBookedAt
      ? new Date(meetingBookedAt.getTime() + (1 + (index % 4)) * DAY)
      : null;

    const stageKey = won
      ? 'won'
      : lost
        ? 'lost'
        : quotation
          ? 'quotation'
          : meeting
            ? 'meeting'
            : replied
              ? 'replied'
              : contacted
                ? 'contacted'
                : 'new';

    const stage = stageByKey.get(stageKey);
    if (!stage) throw new Error(`Demo stage "${stageKey}" is missing`);

    const closedAt = won || lost
      ? new Date((quotationSentAt ?? meetingBookedAt ?? firstContactAt ?? capturedAt).getTime() + 2 * DAY)
      : null;

    // Every fifth lead is left unassigned — the gap between captured and
    // assigned is a real leak, and a demo where it is always zero hides it.
    const owner = index % 5 === 0 ? null : owners[index % Math.max(1, owners.length)];
    const lastActivityAt = closedAt ?? quotationSentAt ?? meetingBookedAt ?? firstReplyAt ?? firstContactAt ?? capturedAt;

    const lead = await prisma.lead.create({
      data: {
        organizationId,
        sourceId: source.id,
        stageId: stage.id,
        externalId,
        firstName: `Lead${index + 1}`,
        lastName: DEMO_COMPANIES[index % DEMO_COMPANIES.length]?.split(' ')[0] ?? 'Kumar',
        email: `lead${index + 1}@example.com`,
        phone: `+9198${String(76543210 + index).slice(0, 8)}`,
        company: DEMO_COMPANIES[index % DEMO_COMPANIES.length] ?? 'Acme Traders',
        campaign: index % 3 === 0 ? 'diwali-2026' : 'always-on',
        utmSource: source.key,
        utmMedium: index % 3 === 0 ? 'cpc' : 'organic',
        utmCampaign: index % 3 === 0 ? 'diwali-2026' : null,
        landingPage: `https://acme.example.com/quote?src=${source.key}`,
        estimatedValue: 25_000 + (index % 12) * 15_000,
        currency: 'INR',
        status: won ? LeadStatus.WON : lost ? LeadStatus.LOST : LeadStatus.OPEN,
        lostReason: lost ? ['Budget', 'Chose a competitor', 'No response', 'Timing'][index % 4] ?? 'Budget' : null,
        assignedToId: owner?.id ?? null,
        assignedAt: owner ? new Date(capturedAt.getTime() + HOUR) : null,
        capturedAt,
        firstContactAt,
        firstReplyAt,
        meetingBookedAt,
        quotationSentAt,
        followUpCount: quotation ? 2 : replied ? 1 : 0,
        lastFollowUpAt: replied ? lastActivityAt : null,
        lastActivityAt,
        closedAt,
      },
    });

    await prisma.leadActivity.create({
      data: {
        organizationId,
        leadId: lead.id,
        type: LeadActivityType.CREATED,
        direction: LeadActivityDirection.INBOUND,
        subject: `Lead captured from ${source.name}`,
        occurredAt: capturedAt,
      },
    });

    created += 1;
  }

  console.log(
    created === 0
      ? '  demo leads already present — left untouched'
      : `  ${created} demo leads in "acme": ${DEMO_FUNNEL.captured} captured → ${DEMO_FUNNEL.contacted} contacted → ${DEMO_FUNNEL.replied} replied → ${DEMO_FUNNEL.meeting} meetings → ${DEMO_FUNNEL.quotation} quotations → ${DEMO_FUNNEL.won} won`,
  );
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

  console.log('Seeding lead pipeline...');
  await seedLeadPipeline(organizationIds);
  await seedDemoLeads(organizationIds, ['admin@example.com', 'manager@example.com']);

  console.log('\nDone. Super Admin holds "*" — it covers modules added later with no reseed.');
  console.log('Only Super Admin has organization.manage_all, so every other account is');
  console.log('confined to its own tenant.');
  console.log('\nSign in as admin@example.com and call GET /api/leads/funnel to see the');
  console.log('demo journey and where it breaks.');
}

main()
  .catch((error: unknown) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
