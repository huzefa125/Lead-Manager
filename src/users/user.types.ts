import type { Organization, Permission, Role, User, UserRole } from '@prisma/client';
import type { OrganizationSummary } from '../organizations/organization.serializer';

/** A role as exposed by the API, without its join-table metadata. */
export interface PublicRole {
  id: string;
  name: string;
  displayName: string;
  description: string | null;
  isSystem: boolean;
}

/**
 * The only user shape that may cross the API boundary.
 * `passwordHash` is structurally absent, so leaking it is a type error rather
 * than a code-review catch.
 */
export interface PublicUser {
  id: string;
  email: string;
  name: string | null;
  isActive: boolean;
  organizationId: string;
  /** Present when the organization was loaded alongside the user. */
  organization?: OrganizationSummary;
  roles: PublicRole[];
  /** Effective permissions, unioned across every role the user holds. */
  permissions: string[];
  createdAt: Date;
  updatedAt: Date;
}

/**
 * What `authenticate` attaches to `req.user`.
 *
 * Sourced entirely from the access token's claims — no database read — so it
 * holds only what the token carries. Anything else (profile fields, isActive)
 * must be loaded explicitly by the handler that needs it.
 */
export interface AuthenticatedUser {
  id: string;
  email: string;
  /** The tenant this request acts within. Comes from the signed token only. */
  organizationId: string;
  /** Role names, for `requireRole()` and logging. */
  roles: string[];
  /** Effective permission actions. What `authorize()` checks. */
  permissions: string[];
  /** The token's `jti`, useful for correlating logs to a single session. */
  tokenId: string;
}

export type UserRecord = User;

/** A user with roles, each role's permissions, and the organization loaded. */
export type UserWithRoles = User & {
  organization?: Organization;
  roles: (UserRole & {
    role: Role & {
      permissions: { permission: Permission }[];
    };
  })[];
};
