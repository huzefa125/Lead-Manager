-- RBAC: roles, permissions and their join tables.
--
-- Also retires the `users.role` enum column. Existing users are migrated to an
-- equivalent role assignment first, so nobody loses access across the deploy.

-- ---------------------------------------------------------------------------
-- 1. Schema
-- ---------------------------------------------------------------------------

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "description" TEXT,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "description" TEXT,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assigned_by_id" UUID,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("user_id","role_id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "role_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id","permission_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "roles_name_key" ON "roles"("name");

-- CreateIndex
CREATE INDEX "roles_is_system_idx" ON "roles"("is_system");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_action_key" ON "permissions"("action");

-- CreateIndex
CREATE INDEX "permissions_resource_idx" ON "permissions"("resource");

-- CreateIndex
CREATE INDEX "permissions_is_system_idx" ON "permissions"("is_system");

-- CreateIndex
CREATE INDEX "user_roles_user_id_idx" ON "user_roles"("user_id");

-- CreateIndex
CREATE INDEX "user_roles_role_id_idx" ON "user_roles"("role_id");

-- CreateIndex
CREATE INDEX "role_permissions_role_id_idx" ON "role_permissions"("role_id");

-- CreateIndex
CREATE INDEX "role_permissions_permission_id_idx" ON "role_permissions"("permission_id");

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 2. Baseline roles
--
-- Only the roles needed to migrate existing users are created here; the full
-- permission catalogue is applied idempotently by `prisma/seed.ts`. Keeping the
-- catalogue out of the migration means adding a module later is a seed change,
-- not a schema change.
-- ---------------------------------------------------------------------------

INSERT INTO "roles" ("id", "name", "display_name", "description", "is_system", "created_at", "updated_at")
VALUES
    (gen_random_uuid(), 'super_admin', 'Super Admin', 'Unrestricted access to every resource, including modules added in future.', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'admin',       'Admin',       'Administrative access to business modules and user management.',            true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'user',        'User',        'Default role granted to newly registered accounts. Read-only.',            true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO NOTHING;

-- The global wildcard. Matching is done in application code, so this single row
-- keeps Super Admin correct for resources that do not exist yet.
INSERT INTO "permissions" ("id", "action", "resource", "operation", "description", "is_system", "created_at", "updated_at")
VALUES (gen_random_uuid(), '*', '*', '*', 'Full system access — grants every permission, present and future.', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("action") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "created_at")
SELECT r."id", p."id", CURRENT_TIMESTAMP
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r."name" = 'super_admin' AND p."action" = '*'
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. Migrate existing users off the enum column
--
-- Runs BEFORE the column is dropped. `users.role` is an enum, so it is cast to
-- text for comparison.
-- ---------------------------------------------------------------------------

INSERT INTO "user_roles" ("user_id", "role_id", "assigned_at")
SELECT u."id", r."id", CURRENT_TIMESTAMP
FROM "users" u
JOIN "roles" r
  ON r."name" = CASE WHEN u."role"::text = 'ADMIN' THEN 'admin' ELSE 'user' END
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4. Retire the enum
-- ---------------------------------------------------------------------------

ALTER TABLE "users" DROP COLUMN "role";

DROP TYPE "Role";
