/**
 * The permission catalogue used to seed the database and to name permissions in
 * route definitions.
 *
 * These constants are a convenience for type-safe references in code — they are
 * NOT the source of truth for authorization. The database is. A permission
 * inserted at runtime works immediately without appearing here, which is what
 * makes the system dynamic.
 */

/** Grants everything, including resources that do not exist yet. */
export const WILDCARD = '*';

/** Separator between resource and operation in an action string. */
export const ACTION_SEPARATOR = '.';

/**
 * Standard operations. A module usually needs these four; anything else
 * (`approve`, `export`, `assign`) is added as a plain string.
 */
export const Operation = {
  VIEW: 'view',
  CREATE: 'create',
  UPDATE: 'update',
  DELETE: 'delete',
} as const;

/**
 * Resources known at seed time. Adding a module means adding an entry here and
 * re-running the seed — no authorization code changes.
 */
export const Resource = {
  ORGANIZATION: 'organization',
  USER: 'user',
  ROLE: 'role',
  PERMISSION: 'permission',
  EMPLOYEE: 'employee',
  DEPARTMENT: 'department',
  LEAD: 'lead',
  /**
   * Separate resources, not operations on `lead`, so configuring the pipeline
   * can be granted apart from working it. Note that `lead.*` does not cover
   * these — matching is on the parsed resource, not a string prefix.
   */
  LEAD_SOURCE: 'lead_source',
  LEAD_STAGE: 'lead_stage',
} as const;

/** Builds `resource.operation`, so the format is never hand-typed. */
export const permission = (resource: string, operation: string): string =>
  `${resource}${ACTION_SEPARATOR}${operation}`;

/** Named references for the permissions this application's own routes require. */
export const Permissions = {
  ORGANIZATION_VIEW: permission(Resource.ORGANIZATION, Operation.VIEW),
  ORGANIZATION_CREATE: permission(Resource.ORGANIZATION, Operation.CREATE),
  ORGANIZATION_UPDATE: permission(Resource.ORGANIZATION, Operation.UPDATE),
  ORGANIZATION_DELETE: permission(Resource.ORGANIZATION, Operation.DELETE),
  /**
   * Lifts tenant confinement. Without it every query is filtered to the
   * caller's own organization — see `src/utils/tenant.ts`.
   */
  ORGANIZATION_MANAGE_ALL: permission(Resource.ORGANIZATION, 'manage_all'),

  USER_VIEW: permission(Resource.USER, Operation.VIEW),
  USER_CREATE: permission(Resource.USER, Operation.CREATE),
  USER_UPDATE: permission(Resource.USER, Operation.UPDATE),
  USER_DELETE: permission(Resource.USER, Operation.DELETE),

  ROLE_VIEW: permission(Resource.ROLE, Operation.VIEW),
  ROLE_CREATE: permission(Resource.ROLE, Operation.CREATE),
  ROLE_UPDATE: permission(Resource.ROLE, Operation.UPDATE),
  ROLE_DELETE: permission(Resource.ROLE, Operation.DELETE),
  /** Assigning roles to users is separated from editing roles themselves. */
  ROLE_ASSIGN: permission(Resource.ROLE, 'assign'),

  PERMISSION_VIEW: permission(Resource.PERMISSION, Operation.VIEW),
  PERMISSION_CREATE: permission(Resource.PERMISSION, Operation.CREATE),
  PERMISSION_UPDATE: permission(Resource.PERMISSION, Operation.UPDATE),
  PERMISSION_DELETE: permission(Resource.PERMISSION, Operation.DELETE),

  LEAD_VIEW: permission(Resource.LEAD, Operation.VIEW),
  LEAD_CREATE: permission(Resource.LEAD, Operation.CREATE),
  /** Also covers moving a lead between stages and logging activity on it. */
  LEAD_UPDATE: permission(Resource.LEAD, Operation.UPDATE),
  LEAD_DELETE: permission(Resource.LEAD, Operation.DELETE),
  /** Separated from `lead.update`: deciding who owns a lead is a manager's call. */
  LEAD_ASSIGN: permission(Resource.LEAD, 'assign'),
  /**
   * The integration endpoint. Held by the service accounts that forward leads
   * from website forms, ad platforms and inboxes — which should be able to
   * create leads and nothing else.
   */
  LEAD_CAPTURE: permission(Resource.LEAD, 'capture'),

  LEAD_SOURCE_VIEW: permission(Resource.LEAD_SOURCE, Operation.VIEW),
  LEAD_SOURCE_CREATE: permission(Resource.LEAD_SOURCE, Operation.CREATE),
  LEAD_SOURCE_UPDATE: permission(Resource.LEAD_SOURCE, Operation.UPDATE),
  LEAD_SOURCE_DELETE: permission(Resource.LEAD_SOURCE, Operation.DELETE),

  LEAD_STAGE_VIEW: permission(Resource.LEAD_STAGE, Operation.VIEW),
  LEAD_STAGE_CREATE: permission(Resource.LEAD_STAGE, Operation.CREATE),
  LEAD_STAGE_UPDATE: permission(Resource.LEAD_STAGE, Operation.UPDATE),
  LEAD_STAGE_DELETE: permission(Resource.LEAD_STAGE, Operation.DELETE),
} as const;

/** Role keys that carry special meaning in code. */
export const SystemRole = {
  SUPER_ADMIN: 'super_admin',
  ADMIN: 'admin',
  USER: 'user',
} as const;

/** Role assigned automatically at registration. */
export const DEFAULT_ROLE = SystemRole.USER;

export interface PermissionSeed {
  action: string;
  resource: string;
  operation: string;
  description: string;
}

/**
 * Expands a resource into its four standard CRUD permissions plus the
 * `<resource>.*` wildcard.
 *
 * The wildcard has to exist as a row to be grantable — a role can only be
 * granted permissions that are in the table, so omitting it would silently
 * reduce any role that asks for it.
 */
function crudFor(resource: string, label: string): PermissionSeed[] {
  const operations = [
    { operation: Operation.VIEW, verb: 'View' },
    { operation: Operation.CREATE, verb: 'Create' },
    { operation: Operation.UPDATE, verb: 'Update' },
    { operation: Operation.DELETE, verb: 'Delete' },
  ].map(({ operation, verb }) => ({
    action: permission(resource, operation),
    resource,
    operation,
    description: `${verb} ${label}`,
  }));

  return [
    ...operations,
    {
      action: permission(resource, WILDCARD),
      resource,
      operation: WILDCARD,
      description: `Full access to ${label}, including operations added later`,
    },
  ];
}

/**
 * Everything the seed inserts. Extend this list to add a module; the
 * authorization logic never changes.
 */
export const PERMISSION_CATALOGUE: PermissionSeed[] = [
  {
    action: WILDCARD,
    resource: WILDCARD,
    operation: WILDCARD,
    description: 'Full system access — grants every permission, present and future.',
  },
  ...crudFor(Resource.ORGANIZATION, 'organizations'),
  {
    action: Permissions.ORGANIZATION_MANAGE_ALL,
    resource: Resource.ORGANIZATION,
    operation: 'manage_all',
    description: 'Act across every organization — platform administrators only',
  },
  ...crudFor(Resource.USER, 'user accounts'),
  ...crudFor(Resource.ROLE, 'roles'),
  {
    action: Permissions.ROLE_ASSIGN,
    resource: Resource.ROLE,
    operation: 'assign',
    description: 'Assign and remove roles on user accounts',
  },
  ...crudFor(Resource.PERMISSION, 'permissions'),
  ...crudFor(Resource.EMPLOYEE, 'employees'),
  ...crudFor(Resource.DEPARTMENT, 'departments'),
  ...crudFor(Resource.LEAD, 'leads'),
  {
    action: Permissions.LEAD_ASSIGN,
    resource: Resource.LEAD,
    operation: 'assign',
    description: 'Assign leads to salespeople',
  },
  {
    action: Permissions.LEAD_CAPTURE,
    resource: Resource.LEAD,
    operation: 'capture',
    description: 'Submit leads through the capture endpoint (integrations)',
  },
  ...crudFor(Resource.LEAD_SOURCE, 'lead sources'),
  ...crudFor(Resource.LEAD_STAGE, 'pipeline stages'),
];

export interface RoleSeed {
  name: string;
  displayName: string;
  description: string;
  /** Actions to grant. Wildcards are permitted and expected. */
  permissions: string[];
}

/**
 * Baseline roles.
 *
 * Super Admin holds the single `*` permission rather than an enumerated list —
 * so a module added next year is covered with no migration and no seed rerun.
 */
export const ROLE_CATALOGUE: RoleSeed[] = [
  {
    name: SystemRole.SUPER_ADMIN,
    displayName: 'Super Admin',
    description: 'Unrestricted access to every resource, including modules added in future.',
    permissions: [WILDCARD],
  },
  {
    name: SystemRole.ADMIN,
    displayName: 'Admin',
    description:
      'Administers their own organization. Deliberately excludes organization.manage_all, so every query stays confined to their tenant.',
    permissions: [
      // View and rename their own organization, but not create or delete
      // organizations, and not reach across tenants.
      Permissions.ORGANIZATION_VIEW,
      Permissions.ORGANIZATION_UPDATE,
      `${Resource.USER}.${WILDCARD}`,
      `${Resource.EMPLOYEE}.${WILDCARD}`,
      `${Resource.DEPARTMENT}.${WILDCARD}`,
      // Three separate wildcards: `lead.*` covers neither of the other two,
      // since matching is on the parsed resource rather than a string prefix.
      `${Resource.LEAD}.${WILDCARD}`,
      `${Resource.LEAD_SOURCE}.${WILDCARD}`,
      `${Resource.LEAD_STAGE}.${WILDCARD}`,
      Permissions.ROLE_VIEW,
      Permissions.ROLE_ASSIGN,
      Permissions.PERMISSION_VIEW,
    ],
  },
  {
    name: 'manager',
    displayName: 'Manager',
    description:
      'Works the pipeline: creates leads, logs activity, moves stages and assigns owners. Cannot reshape the pipeline itself.',
    permissions: [
      Permissions.ORGANIZATION_VIEW,
      Permissions.USER_VIEW,
      permission(Resource.EMPLOYEE, Operation.VIEW),
      permission(Resource.EMPLOYEE, Operation.CREATE),
      permission(Resource.EMPLOYEE, Operation.UPDATE),
      permission(Resource.DEPARTMENT, Operation.VIEW),
      Permissions.LEAD_VIEW,
      Permissions.LEAD_CREATE,
      Permissions.LEAD_UPDATE,
      Permissions.LEAD_ASSIGN,
      // View-only on the catalogue: renaming a stage rewrites how every report
      // in the organization reads, so it stays an administrator's decision.
      Permissions.LEAD_SOURCE_VIEW,
      Permissions.LEAD_STAGE_VIEW,
    ],
  },
  {
    name: SystemRole.USER,
    displayName: 'User',
    description: 'Default role granted to newly registered accounts. Read-only.',
    permissions: [
      permission(Resource.EMPLOYEE, Operation.VIEW),
      permission(Resource.DEPARTMENT, Operation.VIEW),
      // Read-only on leads too. A salesperson who must log calls needs
      // `manager`, or a custom role with lead.update — created through the API,
      // since roles are rows.
      Permissions.LEAD_VIEW,
      Permissions.LEAD_SOURCE_VIEW,
      Permissions.LEAD_STAGE_VIEW,
    ],
  },
];
