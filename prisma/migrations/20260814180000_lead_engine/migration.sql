-- Lead engine: sources, stages, leads and the activity timeline.
--
-- Two things in here are worth reading before changing anything:
--
--   1. `leads` carries write-once milestone columns alongside its current
--      stage. Stage answers "where is this lead now" and moves in both
--      directions; milestones answer "how far did it ever get" and only ever
--      move forward. A funnel built on current stage under-reports every lead
--      that was pushed back a step, which is why both exist.
--
--   2. Sources and stages are seeded *per organization* rather than being
--      global rows, so a tenant can rename or reorder its pipeline without
--      affecting anyone else. Section 4 backfills them for organizations that
--      already exist.

-- ---------------------------------------------------------------------------
-- 1. Enums
-- ---------------------------------------------------------------------------

-- CreateEnum
CREATE TYPE "lead_channel" AS ENUM (
    'WEBSITE_FORM', 'WHATSAPP', 'INSTAGRAM', 'FACEBOOK', 'GOOGLE_ADS',
    'LINKEDIN', 'EMAIL', 'PHONE', 'CRM_IMPORT', 'BOOKING', 'REFERRAL',
    'MANUAL', 'OTHER'
);

-- CreateEnum
CREATE TYPE "lead_stage_type" AS ENUM ('OPEN', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "lead_status" AS ENUM ('OPEN', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "lead_activity_type" AS ENUM (
    'NOTE', 'CALL', 'EMAIL', 'WHATSAPP', 'SMS', 'MEETING', 'QUOTATION',
    'FOLLOW_UP', 'TASK', 'CREATED', 'ASSIGNED', 'STAGE_CHANGED',
    'STATUS_CHANGED'
);

-- CreateEnum
CREATE TYPE "lead_activity_direction" AS ENUM ('INBOUND', 'OUTBOUND', 'INTERNAL');

-- ---------------------------------------------------------------------------
-- 2. Tables
-- ---------------------------------------------------------------------------

-- CreateTable
CREATE TABLE "lead_sources" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "channel" "lead_channel" NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_stages" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "position" INTEGER NOT NULL,
    "type" "lead_stage_type" NOT NULL DEFAULT 'OPEN',
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "first_name" TEXT,
    "last_name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "whatsapp" TEXT,
    "company" TEXT,
    "job_title" TEXT,
    "website" TEXT,
    "source_id" UUID NOT NULL,
    "campaign" TEXT,
    "landing_page" TEXT,
    "utm_source" TEXT,
    "utm_medium" TEXT,
    "utm_campaign" TEXT,
    "utm_term" TEXT,
    "utm_content" TEXT,
    "referrer" TEXT,
    "external_id" TEXT,
    "estimated_value" DECIMAL(14,2),
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "stage_id" UUID NOT NULL,
    "status" "lead_status" NOT NULL DEFAULT 'OPEN',
    "lost_reason" TEXT,
    "notes" TEXT,
    "assigned_to_id" UUID,
    "created_by_id" UUID,
    "captured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assigned_at" TIMESTAMP(3),
    "first_contact_at" TIMESTAMP(3),
    "first_reply_at" TIMESTAMP(3),
    "meeting_booked_at" TIMESTAMP(3),
    "quotation_sent_at" TIMESTAMP(3),
    "last_follow_up_at" TIMESTAMP(3),
    "follow_up_count" INTEGER NOT NULL DEFAULT 0,
    "last_activity_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_activities" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "type" "lead_activity_type" NOT NULL,
    "direction" "lead_activity_direction" NOT NULL DEFAULT 'INTERNAL',
    "subject" TEXT,
    "body" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "duration_minutes" INTEGER,
    "metadata" JSONB,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_activities_pkey" PRIMARY KEY ("id")
);

-- ---------------------------------------------------------------------------
-- 3. Indexes and foreign keys
-- ---------------------------------------------------------------------------

-- CreateIndex
CREATE UNIQUE INDEX "lead_sources_organization_id_key_key" ON "lead_sources"("organization_id", "key");
CREATE INDEX "lead_sources_organization_id_is_active_idx" ON "lead_sources"("organization_id", "is_active");
CREATE INDEX "lead_sources_organization_id_channel_idx" ON "lead_sources"("organization_id", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "lead_stages_organization_id_key_key" ON "lead_stages"("organization_id", "key");
CREATE INDEX "lead_stages_organization_id_position_idx" ON "lead_stages"("organization_id", "position");

-- CreateIndex
-- NULLs are distinct in Postgres, so leads with no external id are
-- unconstrained — which is exactly what manual entry needs, while a redelivered
-- webhook carrying the same id still collapses to one lead.
CREATE UNIQUE INDEX "leads_source_id_external_id_key" ON "leads"("source_id", "external_id");
CREATE INDEX "leads_organization_id_status_idx" ON "leads"("organization_id", "status");
CREATE INDEX "leads_organization_id_stage_id_idx" ON "leads"("organization_id", "stage_id");
CREATE INDEX "leads_organization_id_assigned_to_id_idx" ON "leads"("organization_id", "assigned_to_id");
CREATE INDEX "leads_organization_id_source_id_idx" ON "leads"("organization_id", "source_id");
CREATE INDEX "leads_organization_id_captured_at_idx" ON "leads"("organization_id", "captured_at");
CREATE INDEX "leads_organization_id_email_idx" ON "leads"("organization_id", "email");
CREATE INDEX "leads_organization_id_phone_idx" ON "leads"("organization_id", "phone");

-- CreateIndex
CREATE INDEX "lead_activities_lead_id_occurred_at_idx" ON "lead_activities"("lead_id", "occurred_at");
CREATE INDEX "lead_activities_organization_id_occurred_at_idx" ON "lead_activities"("organization_id", "occurred_at");
CREATE INDEX "lead_activities_organization_id_type_idx" ON "lead_activities"("organization_id", "type");
CREATE INDEX "lead_activities_created_by_id_idx" ON "lead_activities"("created_by_id");

-- AddForeignKey
ALTER TABLE "lead_sources" ADD CONSTRAINT "lead_sources_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lead_stages" ADD CONSTRAINT "lead_stages_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "leads" ADD CONSTRAINT "leads_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RESTRICT, not CASCADE: deleting a source or a stage must not silently delete
-- the pipeline sitting in it. The service returns 409 and asks for a move.
ALTER TABLE "leads" ADD CONSTRAINT "leads_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "lead_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "leads" ADD CONSTRAINT "leads_stage_id_fkey" FOREIGN KEY ("stage_id") REFERENCES "lead_stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- SET NULL: a salesperson leaving must not delete their pipeline.
ALTER TABLE "leads" ADD CONSTRAINT "leads_assigned_to_id_fkey" FOREIGN KEY ("assigned_to_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 4. Backfill: every existing organization gets the default pipeline
--
-- The application also provisions these on demand (`ensureLeadDefaults`), so a
-- tenant created after this migration is covered too. Doing it here as well
-- means an environment that only runs migrations is immediately usable.
-- ---------------------------------------------------------------------------

INSERT INTO "lead_stages" ("id", "organization_id", "key", "name", "description", "position", "type", "is_system", "created_at", "updated_at")
SELECT gen_random_uuid(), o."id", s."key", s."name", s."description", s."position", s."type"::"lead_stage_type", true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "organizations" o
CROSS JOIN (VALUES
    ('new',       'New',            'Captured, not yet worked.',                1, 'OPEN'),
    ('contacted', 'Contacted',      'We have reached out at least once.',       2, 'OPEN'),
    ('replied',   'Replied',        'The lead answered.',                       3, 'OPEN'),
    ('meeting',   'Meeting Booked', 'A call or demo is on the calendar.',       4, 'OPEN'),
    ('quotation', 'Quotation Sent', 'Pricing is with the lead.',                5, 'OPEN'),
    ('follow_up', 'Follow-up',      'Awaiting a decision; chasing.',            6, 'OPEN'),
    ('won',       'Won',            'Closed won.',                              7, 'WON'),
    ('lost',      'Lost',           'Closed lost.',                             8, 'LOST')
) AS s("key", "name", "description", "position", "type")
ON CONFLICT ("organization_id", "key") DO NOTHING;

INSERT INTO "lead_sources" ("id", "organization_id", "key", "name", "channel", "description", "is_active", "is_system", "created_at", "updated_at")
SELECT gen_random_uuid(), o."id", s."key", s."name", s."channel"::"lead_channel", s."description", true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "organizations" o
CROSS JOIN (VALUES
    ('website_form', 'Website Form',       'WEBSITE_FORM', 'Forms embedded on your own site.'),
    ('whatsapp',     'WhatsApp',           'WHATSAPP',     'WhatsApp Business enquiries.'),
    ('instagram',    'Instagram',          'INSTAGRAM',    'Instagram lead ads and DMs.'),
    ('facebook',     'Facebook',           'FACEBOOK',     'Facebook lead ads and Messenger.'),
    ('google_ads',   'Google Ads',         'GOOGLE_ADS',   'Google lead form extensions and landing pages.'),
    ('linkedin',     'LinkedIn',           'LINKEDIN',     'LinkedIn lead gen forms and InMail.'),
    ('email',        'Email',              'EMAIL',        'Inbound email to a monitored mailbox.'),
    ('phone',        'Phone',              'PHONE',        'Inbound calls and call-tracking logs.'),
    ('crm_import',   'CRM Import',         'CRM_IMPORT',   'Bulk import from another CRM.'),
    ('booking',      'Booking Page',       'BOOKING',      'Calendly and other self-serve booking forms.'),
    ('referral',     'Referral',           'REFERRAL',     'Introduced by a customer or partner.'),
    ('manual',       'Manual Entry',       'MANUAL',       'Typed in by a salesperson.'),
    ('other',        'Other',              'OTHER',        'Anything without a dedicated source yet.')
) AS s("key", "name", "channel", "description")
ON CONFLICT ("organization_id", "key") DO NOTHING;

-- ---------------------------------------------------------------------------
-- 5. Permissions for the new module
--
-- Inserted here rather than left to the seed, so an environment that only runs
-- migrations still has a coherent permission catalogue.
--
-- `lead.*` deliberately does NOT cover `lead_source.view` — matching is on the
-- parsed resource, not a string prefix — so the catalogue and the pipeline
-- configuration are grantable separately.
-- ---------------------------------------------------------------------------

INSERT INTO "permissions" ("id", "action", "resource", "operation", "description", "is_system", "created_at", "updated_at")
VALUES
    (gen_random_uuid(), 'lead.view',          'lead',        'view',    'View leads',                                                     true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'lead.create',        'lead',        'create',  'Create leads',                                                   true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'lead.update',        'lead',        'update',  'Update leads, move them between stages, and log activity',       true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'lead.delete',        'lead',        'delete',  'Delete leads',                                                   true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'lead.*',             'lead',        '*',       'Full access to leads, including operations added later',         true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'lead.assign',        'lead',        'assign',  'Assign leads to salespeople',                                    true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'lead.capture',       'lead',        'capture', 'Submit leads through the capture endpoint (integrations)',       true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'lead_source.view',   'lead_source', 'view',    'View lead sources',                                              true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'lead_source.create', 'lead_source', 'create',  'Create lead sources',                                            true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'lead_source.update', 'lead_source', 'update',  'Update lead sources',                                            true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'lead_source.delete', 'lead_source', 'delete',  'Delete lead sources',                                            true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'lead_source.*',      'lead_source', '*',       'Full access to lead sources, including operations added later',  true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'lead_stage.view',    'lead_stage',  'view',    'View pipeline stages',                                           true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'lead_stage.create',  'lead_stage',  'create',  'Create pipeline stages',                                         true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'lead_stage.update',  'lead_stage',  'update',  'Update and reorder pipeline stages',                             true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'lead_stage.delete',  'lead_stage',  'delete',  'Delete pipeline stages',                                         true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'lead_stage.*',       'lead_stage',  '*',       'Full access to pipeline stages, including operations added later', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("action") DO NOTHING;

-- Grant the new module to the existing seeded roles, so an upgraded database
-- does not leave every administrator locked out of the feature they just
-- migrated in. Super Admin needs nothing here — it holds '*'.
INSERT INTO "role_permissions" ("role_id", "permission_id", "created_at")
SELECT r."id", p."id", CURRENT_TIMESTAMP
FROM "roles" r
JOIN "permissions" p ON p."action" IN ('lead.*', 'lead_source.*', 'lead_stage.*')
WHERE r."name" = 'admin'
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "created_at")
SELECT r."id", p."id", CURRENT_TIMESTAMP
FROM "roles" r
JOIN "permissions" p ON p."action" IN (
    'lead.view', 'lead.create', 'lead.update', 'lead.assign',
    'lead_source.view', 'lead_stage.view'
)
WHERE r."name" = 'manager'
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "created_at")
SELECT r."id", p."id", CURRENT_TIMESTAMP
FROM "roles" r
JOIN "permissions" p ON p."action" IN ('lead.view', 'lead_source.view', 'lead_stage.view')
WHERE r."name" = 'user'
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
