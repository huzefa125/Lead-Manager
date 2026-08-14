/**
 * OpenAPI fragments for the RBAC endpoints, kept separate so `openapi.ts` stays
 * readable. Merged into the document at build time.
 */

const ROLE_EXAMPLE = {
  id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  name: 'manager',
  displayName: 'Manager',
  description: 'Manages employees and views departments.',
  isSystem: true,
  permissions: ['department.view', 'employee.create', 'employee.update', 'employee.view'],
  createdAt: '2026-08-14T09:00:00.000Z',
  updatedAt: '2026-08-14T09:00:00.000Z',
};

const PERMISSION_EXAMPLE = {
  id: 'c9b1f2a3-1111-4222-8333-444455556666',
  action: 'employee.create',
  resource: 'employee',
  operation: 'create',
  description: 'Create employees',
  isSystem: true,
};

const PAGINATION_EXAMPLE = { total: 27, page: 1, limit: 20, totalPages: 2 };

/** Reusable `{ success, data, meta }` wrapper. */
const envelope = (dataSchema: object) => ({
  type: 'object',
  required: ['success', 'data', 'meta'],
  properties: {
    success: { type: 'boolean', enum: [true] },
    data: dataSchema,
    meta: { $ref: '#/components/schemas/ResponseMeta' },
  },
});

const forbiddenResponse = {
  description:
    'Authenticated, but the token does not carry the required permission. The message names the permission an administrator would need to grant.',
  content: {
    'application/json': {
      schema: { $ref: '#/components/schemas/ErrorResponse' },
      example: {
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'You do not have permission to perform this action. Required: role.create',
        },
        meta: {
          requestId: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
          timestamp: '2026-08-14T09:12:33.114Z',
        },
      },
    },
  },
};

const idParam = {
  name: 'id',
  in: 'path',
  required: true,
  schema: { type: 'string', format: 'uuid' },
  description: 'UUID of the record.',
};

const paginationParams = [
  { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
  {
    name: 'limit',
    in: 'query',
    schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
  },
  { name: 'search', in: 'query', schema: { type: 'string' }, description: 'Free-text filter.' },
];

export const rbacSchemas = {
  Role: {
    type: 'object',
    description: 'A named bundle of permissions. `permissions` is a flat list of action strings.',
    properties: {
      id: { type: 'string', format: 'uuid' },
      name: {
        type: 'string',
        description: 'Stable machine key, lower_snake_case. Immutable once created.',
        example: 'manager',
      },
      displayName: { type: 'string', example: 'Manager' },
      description: { type: 'string', nullable: true },
      isSystem: {
        type: 'boolean',
        description: 'Seeded role. Cannot be deleted; Super Admin also cannot be edited.',
      },
      permissions: {
        type: 'array',
        items: { type: 'string' },
        example: ['employee.view', 'employee.create'],
      },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
    example: ROLE_EXAMPLE,
  },

  Permission: {
    type: 'object',
    description:
      'A single grantable capability, addressed as `resource.operation`. Wildcards (`*`, `employee.*`) are ordinary rows.',
    properties: {
      id: { type: 'string', format: 'uuid' },
      action: { type: 'string', example: 'employee.create' },
      resource: { type: 'string', example: 'employee' },
      operation: { type: 'string', example: 'create' },
      description: { type: 'string', nullable: true },
      isSystem: { type: 'boolean' },
    },
    example: PERMISSION_EXAMPLE,
  },

  Pagination: {
    type: 'object',
    properties: {
      total: { type: 'integer' },
      page: { type: 'integer' },
      limit: { type: 'integer' },
      totalPages: { type: 'integer' },
    },
    example: PAGINATION_EXAMPLE,
  },
};

export const rbacPaths = {
  // --- Roles -----------------------------------------------------------------

  '/roles': {
    get: {
      tags: ['Roles'],
      summary: 'List roles',
      description: 'Requires `role.view`.',
      operationId: 'listRoles',
      parameters: paginationParams,
      responses: {
        '200': {
          description: 'Paginated roles with their granted actions.',
          content: {
            'application/json': {
              schema: envelope({
                type: 'object',
                properties: {
                  roles: { type: 'array', items: { $ref: '#/components/schemas/Role' } },
                  pagination: { $ref: '#/components/schemas/Pagination' },
                },
              }),
              example: {
                success: true,
                data: { roles: [ROLE_EXAMPLE], pagination: PAGINATION_EXAMPLE },
                meta: { requestId: '...', timestamp: '...' },
              },
            },
          },
        },
        '401': { $ref: '#/components/responses/Unauthorized' },
        '403': forbiddenResponse,
      },
    },
    post: {
      tags: ['Roles'],
      summary: 'Create a role',
      description:
        'Requires `role.create`. Grants are given as action strings and must already exist as permissions — an unknown action returns 422 naming it, rather than silently creating a weaker role than requested.',
      operationId: 'createRole',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['name', 'displayName'],
              properties: {
                name: {
                  type: 'string',
                  pattern: '^[a-z][a-z0-9_]*$',
                  description: 'lower_snake_case. Immutable after creation.',
                  example: 'finance_manager',
                },
                displayName: { type: 'string', example: 'Finance Manager' },
                description: { type: 'string' },
                permissions: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Action strings. Wildcards allowed.',
                  example: ['employee.view', 'department.*'],
                },
              },
            },
            examples: {
              scoped: {
                summary: 'Specific grants',
                value: {
                  name: 'finance_manager',
                  displayName: 'Finance Manager',
                  description: 'Manages finance records',
                  permissions: ['employee.view', 'department.view'],
                },
              },
              wildcard: {
                summary: 'Full access to one module',
                value: {
                  name: 'hr_lead',
                  displayName: 'HR Lead',
                  permissions: ['employee.*'],
                },
              },
            },
          },
        },
      },
      responses: {
        '201': {
          description: 'Role created.',
          content: {
            'application/json': {
              schema: envelope({
                type: 'object',
                properties: { role: { $ref: '#/components/schemas/Role' } },
              }),
            },
          },
        },
        '401': { $ref: '#/components/responses/Unauthorized' },
        '403': forbiddenResponse,
        '409': {
          description: 'A role with that name already exists.',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
        },
        '422': { $ref: '#/components/responses/ValidationError' },
      },
    },
  },

  '/roles/{id}': {
    get: {
      tags: ['Roles'],
      summary: 'Get a role',
      description: 'Requires `role.view`.',
      operationId: 'getRole',
      parameters: [idParam],
      responses: {
        '200': {
          description: 'The role.',
          content: {
            'application/json': {
              schema: envelope({
                type: 'object',
                properties: { role: { $ref: '#/components/schemas/Role' } },
              }),
            },
          },
        },
        '401': { $ref: '#/components/responses/Unauthorized' },
        '403': forbiddenResponse,
        '404': { description: 'No such role.' },
      },
    },
    patch: {
      tags: ['Roles'],
      summary: 'Update a role label',
      description:
        'Requires `role.update`. Only `displayName` and `description` are mutable — `name` is referenced by code and seeds, so renaming would silently break authorization. The Super Admin role cannot be modified.',
      operationId: 'updateRole',
      parameters: [idParam],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                displayName: { type: 'string' },
                description: { type: 'string', nullable: true },
              },
            },
            example: { displayName: 'Regional Manager' },
          },
        },
      },
      responses: {
        '200': { description: 'Updated.' },
        '401': { $ref: '#/components/responses/Unauthorized' },
        '403': forbiddenResponse,
        '404': { description: 'No such role.' },
        '422': { $ref: '#/components/responses/ValidationError' },
      },
    },
    delete: {
      tags: ['Roles'],
      summary: 'Delete a role',
      description:
        'Requires `role.delete`. Refuses to delete a system role, or one still assigned to users — reassign them first, so nobody silently loses access.',
      operationId: 'deleteRole',
      parameters: [idParam],
      responses: {
        '200': { description: 'Deleted.' },
        '401': { $ref: '#/components/responses/Unauthorized' },
        '403': forbiddenResponse,
        '404': { description: 'No such role.' },
        '409': { description: 'Role is still assigned to one or more users.' },
      },
    },
  },

  '/roles/{id}/permissions': {
    put: {
      tags: ['Roles'],
      summary: 'Replace a role\'s permissions',
      description:
        'Requires `role.update`. Replaces the entire grant set in one transaction — an observer sees either the old set or the new one, never an empty window. An empty array revokes everything.',
      operationId: 'setRolePermissions',
      parameters: [idParam],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['permissions'],
              properties: { permissions: { type: 'array', items: { type: 'string' } } },
            },
            example: { permissions: ['employee.view', 'employee.create', 'department.view'] },
          },
        },
      },
      responses: {
        '200': { description: 'Grants replaced.' },
        '401': { $ref: '#/components/responses/Unauthorized' },
        '403': forbiddenResponse,
        '404': { description: 'No such role.' },
        '422': {
          description: 'One or more actions do not exist. The response names them.',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
        },
      },
    },
    post: {
      tags: ['Roles'],
      summary: 'Add permissions to a role',
      description:
        'Requires `role.update`. Adds without disturbing existing grants; re-granting one already held is a no-op.',
      operationId: 'addRolePermissions',
      parameters: [idParam],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['permissions'],
              properties: { permissions: { type: 'array', items: { type: 'string' }, minItems: 1 } },
            },
            example: { permissions: ['employee.delete'] },
          },
        },
      },
      responses: {
        '200': { description: 'Grants added.' },
        '401': { $ref: '#/components/responses/Unauthorized' },
        '403': forbiddenResponse,
        '422': { $ref: '#/components/responses/ValidationError' },
      },
    },
    delete: {
      tags: ['Roles'],
      summary: 'Revoke permissions from a role',
      description: 'Requires `role.update`. Revoking one not held is a no-op.',
      operationId: 'removeRolePermissions',
      parameters: [idParam],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['permissions'],
              properties: { permissions: { type: 'array', items: { type: 'string' }, minItems: 1 } },
            },
            example: { permissions: ['employee.delete'] },
          },
        },
      },
      responses: {
        '200': { description: 'Grants revoked.' },
        '401': { $ref: '#/components/responses/Unauthorized' },
        '403': forbiddenResponse,
      },
    },
  },

  // --- Permissions -----------------------------------------------------------

  '/permissions': {
    get: {
      tags: ['Permissions'],
      summary: 'List permissions',
      description:
        'Requires `permission.view`. Also returns a `byResource` map, so an admin UI can render modules without re-bucketing client-side.',
      operationId: 'listPermissions',
      parameters: [
        ...paginationParams,
        {
          name: 'resource',
          in: 'query',
          schema: { type: 'string' },
          description: 'Filter to one module, e.g. `employee`.',
        },
      ],
      responses: {
        '200': {
          description: 'Paginated permissions, plus a grouped view.',
          content: {
            'application/json': {
              schema: envelope({
                type: 'object',
                properties: {
                  permissions: {
                    type: 'array',
                    items: { $ref: '#/components/schemas/Permission' },
                  },
                  byResource: {
                    type: 'object',
                    additionalProperties: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/Permission' },
                    },
                  },
                  pagination: { $ref: '#/components/schemas/Pagination' },
                },
              }),
            },
          },
        },
        '401': { $ref: '#/components/responses/Unauthorized' },
        '403': forbiddenResponse,
      },
    },
    post: {
      tags: ['Permissions'],
      summary: 'Register a new permission',
      description:
        'Requires `permission.create`.\n\n' +
        'This is the whole process for adding a module: insert `invoice.approve`, grant it to a role, and `authorize("invoice.approve")` starts enforcing it — no deployment, no change to the authorization logic. `resource` and `operation` are derived from the action.\n\n' +
        'Super Admin covers the new permission immediately, because it holds `*`.',
      operationId: 'createPermission',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['action'],
              properties: {
                action: {
                  type: 'string',
                  description: '`resource.operation`, `resource.*`, or `*`. lower_snake_case.',
                  example: 'invoice.approve',
                },
                description: { type: 'string' },
              },
            },
            examples: {
              newModule: {
                summary: 'A capability for a brand new module',
                value: { action: 'invoice.approve', description: 'Approve invoices' },
              },
              moduleWildcard: {
                summary: 'Full access to a module',
                value: { action: 'invoice.*', description: 'Full access to invoices' },
              },
            },
          },
        },
      },
      responses: {
        '201': { description: 'Permission registered.' },
        '401': { $ref: '#/components/responses/Unauthorized' },
        '403': forbiddenResponse,
        '409': { description: 'That action already exists.' },
        '422': { $ref: '#/components/responses/ValidationError' },
      },
    },
  },

  '/permissions/{id}': {
    get: {
      tags: ['Permissions'],
      summary: 'Get a permission',
      description: 'Requires `permission.view`.',
      operationId: 'getPermission',
      parameters: [idParam],
      responses: {
        '200': { description: 'The permission.' },
        '401': { $ref: '#/components/responses/Unauthorized' },
        '403': forbiddenResponse,
        '404': { description: 'No such permission.' },
      },
    },
    patch: {
      tags: ['Permissions'],
      summary: 'Update a permission description',
      description:
        'Requires `permission.update`. Only the description is mutable — renaming an action would break every `authorize()` call and every role granting it.',
      operationId: 'updatePermission',
      parameters: [idParam],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['description'],
              properties: { description: { type: 'string', nullable: true } },
            },
            example: { description: 'Approve invoices up to £10,000' },
          },
        },
      },
      responses: {
        '200': { description: 'Updated.' },
        '401': { $ref: '#/components/responses/Unauthorized' },
        '403': forbiddenResponse,
        '404': { description: 'No such permission.' },
      },
    },
    delete: {
      tags: ['Permissions'],
      summary: 'Delete a permission',
      description:
        'Requires `permission.delete`. Refuses to delete a system permission, or one still granted to a role — revoke it first, so no role is silently weakened.',
      operationId: 'deletePermission',
      parameters: [idParam],
      responses: {
        '200': { description: 'Deleted.' },
        '401': { $ref: '#/components/responses/Unauthorized' },
        '403': forbiddenResponse,
        '409': { description: 'Still granted to one or more roles.' },
      },
    },
  },

  // --- Users -----------------------------------------------------------------

  '/users': {
    get: {
      tags: ['Users'],
      summary: 'List users',
      description: 'Requires `user.view`. Each user includes their roles and effective permissions.',
      operationId: 'listUsers',
      parameters: [
        ...paginationParams,
        {
          name: 'role',
          in: 'query',
          schema: { type: 'string' },
          description: 'Filter to holders of a role, e.g. `admin`.',
        },
      ],
      responses: {
        '200': { description: 'Paginated users.' },
        '401': { $ref: '#/components/responses/Unauthorized' },
        '403': forbiddenResponse,
      },
    },
  },

  '/users/{id}': {
    get: {
      tags: ['Users'],
      summary: 'Get a user',
      description: 'Requires `user.view`.',
      operationId: 'getUserById',
      parameters: [idParam],
      responses: {
        '200': { description: 'The user, with roles and effective permissions.' },
        '401': { $ref: '#/components/responses/Unauthorized' },
        '403': forbiddenResponse,
        '404': { description: 'No such user.' },
      },
    },
  },

  '/users/{id}/roles': {
    put: {
      tags: ['Users'],
      summary: 'Replace a user\'s roles',
      description:
        'Requires `role.assign`.\n\n' +
        'Replaces the whole set; an empty array strips every role. The change and the deletion of that user\'s refresh tokens happen in one transaction — their signed access token still carries the old permissions until it expires, so their sessions are revoked to force a re-authentication.\n\n' +
        'An administrator cannot remove their own administrative roles.',
      operationId: 'setUserRoles',
      parameters: [idParam],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['roles'],
              properties: {
                roles: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Role names. Several roles may be held at once.',
                },
              },
            },
            examples: {
              multiple: { summary: 'Two roles at once', value: { roles: ['manager', 'user'] } },
              stripAll: { summary: 'Remove every role', value: { roles: [] } },
            },
          },
        },
      },
      responses: {
        '200': { description: 'Roles replaced; the user\'s sessions were revoked.' },
        '401': { $ref: '#/components/responses/Unauthorized' },
        '403': forbiddenResponse,
        '404': { description: 'No such user.' },
        '422': { description: 'One or more role names do not exist. The response names them.' },
      },
    },
    post: {
      tags: ['Users'],
      summary: 'Assign roles to a user',
      description: 'Requires `role.assign`. Adds without removing; re-assigning is a no-op.',
      operationId: 'addUserRoles',
      parameters: [idParam],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['roles'],
              properties: { roles: { type: 'array', items: { type: 'string' }, minItems: 1 } },
            },
            example: { roles: ['manager'] },
          },
        },
      },
      responses: {
        '200': { description: 'Roles assigned; the user\'s sessions were revoked.' },
        '401': { $ref: '#/components/responses/Unauthorized' },
        '403': forbiddenResponse,
        '422': { $ref: '#/components/responses/ValidationError' },
      },
    },
    delete: {
      tags: ['Users'],
      summary: 'Remove roles from a user',
      description:
        'Requires `role.assign`. Removing a role the user does not hold is a no-op.',
      operationId: 'removeUserRoles',
      parameters: [idParam],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['roles'],
              properties: { roles: { type: 'array', items: { type: 'string' }, minItems: 1 } },
            },
            example: { roles: ['manager'] },
          },
        },
      },
      responses: {
        '200': { description: 'Roles removed; the user\'s sessions were revoked.' },
        '401': { $ref: '#/components/responses/Unauthorized' },
        '403': forbiddenResponse,
      },
    },
  },
};
