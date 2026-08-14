-- Organizations (tenants).
--
-- `users.organization_id` is NOT NULL, so existing rows must be given an
-- organization before the constraint is applied. The column is added nullable,
-- backfilled, then tightened — the standard three-step so the migration works
-- on a populated database.

-- ---------------------------------------------------------------------------
-- 1. Schema
-- ---------------------------------------------------------------------------

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE INDEX "organizations_is_active_idx" ON "organizations"("is_active");

-- ---------------------------------------------------------------------------
-- 2. Backfill: every existing user joins a default organization
-- ---------------------------------------------------------------------------

INSERT INTO "organizations" ("id", "name", "slug", "description", "is_active", "created_at", "updated_at")
VALUES (
    gen_random_uuid(),
    'Default Organization',
    'default',
    'Created by the organizations migration to hold accounts that predate multi-tenancy.',
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
)
ON CONFLICT ("slug") DO NOTHING;

-- Nullable first, so the ALTER succeeds against existing rows.
ALTER TABLE "users" ADD COLUMN "organization_id" UUID;

UPDATE "users"
SET "organization_id" = (SELECT "id" FROM "organizations" WHERE "slug" = 'default')
WHERE "organization_id" IS NULL;

-- Now the invariant can be enforced.
ALTER TABLE "users" ALTER COLUMN "organization_id" SET NOT NULL;

-- CreateIndex
CREATE INDEX "users_organization_id_idx" ON "users"("organization_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 3. Permissions for the new module
--
-- Inserted here rather than left to the seed, so an environment that only runs
-- migrations still has a coherent permission catalogue.
-- `organization.manage_all` is the cross-tenant capability: without it, every
-- query is confined to the caller's own organization.
-- ---------------------------------------------------------------------------

INSERT INTO "permissions" ("id", "action", "resource", "operation", "description", "is_system", "created_at", "updated_at")
VALUES
    (gen_random_uuid(), 'organization.view',       'organization', 'view',       'View organizations',                                                 true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'organization.create',     'organization', 'create',     'Create organizations',                                               true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'organization.update',     'organization', 'update',     'Update organizations',                                               true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'organization.delete',     'organization', 'delete',     'Delete organizations',                                               true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'organization.*',          'organization', '*',          'Full access to organizations, including operations added later',      true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'organization.manage_all', 'organization', 'manage_all', 'Act across every organization — platform administrators only',        true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("action") DO NOTHING;
