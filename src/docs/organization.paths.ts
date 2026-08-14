/**
 * OpenAPI fragments for the Organizations module, merged into `openapi.ts`.
 */

const ORGANIZATION_EXAMPLE = {
  id: 'd1e2f3a4-5555-4666-8777-888899990000',
  name: 'Acme Corporation',
  slug: 'acme',
  description: 'Demo customer tenant.',
  isActive: true,
  userCount: 3,
  createdAt: '2026-08-14T09:00:00.000Z',
  updatedAt: '2026-08-14T09:00:00.000Z',
};

const envelope = (dataSchema: object) => ({
  type: 'object',
  required: ['success', 'data', 'meta'],
  properties: {
    success: { type: 'boolean', enum: [true] },
    data: dataSchema,
    meta: { $ref: '#/components/schemas/ResponseMeta' },
  },
});

const idParam = {
  name: 'id',
  in: 'path',
  required: true,
  schema: { type: 'string', format: 'uuid' },
};

const notFoundOrOtherTenant = {
  description:
    'No such organization — **or** it belongs to another tenant. The two are deliberately indistinguishable: a 403 would confirm the record exists.',
  content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
};

export const organizationSchemas = {
  Organization: {
    type: 'object',
    description: 'A tenant. Every user belongs to exactly one.',
    properties: {
      id: { type: 'string', format: 'uuid' },
      name: { type: 'string', example: 'Acme Corporation' },
      slug: {
        type: 'string',
        description: 'URL-safe identifier, derived from the name. Immutable once created.',
        example: 'acme',
      },
      description: { type: 'string', nullable: true },
      isActive: {
        type: 'boolean',
        description:
          'Deactivating blocks sign-in for every user in the organization. Requires organization.manage_all.',
      },
      userCount: { type: 'integer', description: 'Present on list and detail responses.' },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
    example: ORGANIZATION_EXAMPLE,
  },
};

export const organizationPaths = {
  '/organizations/current': {
    get: {
      tags: ['Organizations'],
      summary: 'Get your own organization',
      description:
        'The tenant the caller belongs to, taken from the `org` claim in their access token. Needs no permission beyond authentication — every user may see their own organization.',
      operationId: 'getCurrentOrganization',
      responses: {
        '200': {
          description: 'The caller\'s organization.',
          content: {
            'application/json': {
              schema: envelope({
                type: 'object',
                properties: { organization: { $ref: '#/components/schemas/Organization' } },
              }),
              example: {
                success: true,
                data: { organization: ORGANIZATION_EXAMPLE },
                meta: { requestId: '...', timestamp: '...' },
              },
            },
          },
        },
        '401': { $ref: '#/components/responses/Unauthorized' },
      },
    },
  },

  '/organizations': {
    get: {
      tags: ['Organizations'],
      summary: 'List organizations',
      description:
        'Requires `organization.view`.\n\n' +
        '**Tenant-confined.** An ordinary administrator sees exactly one row — their own organization. Only a caller holding `organization.manage_all` sees every tenant.',
      operationId: 'listOrganizations',
      parameters: [
        { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
        {
          name: 'limit',
          in: 'query',
          schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
        },
        { name: 'search', in: 'query', schema: { type: 'string' } },
      ],
      responses: {
        '200': {
          description: 'Paginated organizations, scoped to what the caller may see.',
          content: {
            'application/json': {
              schema: envelope({
                type: 'object',
                properties: {
                  organizations: {
                    type: 'array',
                    items: { $ref: '#/components/schemas/Organization' },
                  },
                  pagination: { $ref: '#/components/schemas/Pagination' },
                },
              }),
            },
          },
        },
        '401': { $ref: '#/components/responses/Unauthorized' },
        '403': { description: 'Missing `organization.view`.' },
      },
    },
    post: {
      tags: ['Organizations'],
      summary: 'Create an organization',
      description:
        'Requires `organization.create`.\n\n' +
        'This is a **platform** operation: it creates a tenant the caller does not belong to. Self-serve tenants come from `POST /auth/register` instead, which creates the organization and its first admin together.\n\n' +
        'The slug is derived from the name unless supplied; a derived collision gets a numeric suffix, while an explicitly supplied duplicate is a 409.',
      operationId: 'createOrganization',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['name'],
              properties: {
                name: { type: 'string', minLength: 2, maxLength: 100, example: 'Contoso Ltd' },
                description: { type: 'string' },
                slug: {
                  type: 'string',
                  pattern: '^[a-z0-9]+(-[a-z0-9]+)*$',
                  description: 'Optional. Derived from the name when omitted.',
                  example: 'contoso',
                },
              },
            },
            examples: {
              derived: { summary: 'Slug derived from the name', value: { name: 'Contoso Ltd' } },
              explicit: {
                summary: 'Explicit slug',
                value: { name: 'Contoso Ltd', slug: 'contoso', description: 'EU subsidiary' },
              },
            },
          },
        },
      },
      responses: {
        '201': { description: 'Organization created.' },
        '401': { $ref: '#/components/responses/Unauthorized' },
        '403': { description: 'Missing `organization.create`.' },
        '409': { description: 'That slug is already taken.' },
        '422': { $ref: '#/components/responses/ValidationError' },
      },
    },
  },

  '/organizations/{id}': {
    get: {
      tags: ['Organizations'],
      summary: 'Get an organization',
      description:
        'Requires `organization.view`. Another tenant\'s organization returns 404, not 403.',
      operationId: 'getOrganization',
      parameters: [idParam],
      responses: {
        '200': { description: 'The organization.' },
        '401': { $ref: '#/components/responses/Unauthorized' },
        '403': { description: 'Missing `organization.view`.' },
        '404': notFoundOrOtherTenant,
      },
    },
    patch: {
      tags: ['Organizations'],
      summary: 'Update an organization',
      description:
        'Requires `organization.update`.\n\n' +
        '`slug` is immutable — it may appear in URLs and integrations, so changing it would silently break external references.\n\n' +
        '`isActive` additionally requires `organization.manage_all`: deactivating locks every user in the tenant out, including the caller, so a tenant admin must not be able to do it to their own organization.',
      operationId: 'updateOrganization',
      parameters: [idParam],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                name: { type: 'string', minLength: 2, maxLength: 100 },
                description: { type: 'string', nullable: true },
                isActive: {
                  type: 'boolean',
                  description: 'Platform administrators only.',
                },
              },
            },
            examples: {
              rename: { summary: 'Rename', value: { name: 'Acme Holdings' } },
              suspend: {
                summary: 'Suspend the tenant (needs organization.manage_all)',
                value: { isActive: false },
              },
            },
          },
        },
      },
      responses: {
        '200': { description: 'Updated.' },
        '401': { $ref: '#/components/responses/Unauthorized' },
        '403': {
          description:
            'Missing `organization.update`, or attempting to change `isActive` without `organization.manage_all`.',
        },
        '404': notFoundOrOtherTenant,
        '422': { $ref: '#/components/responses/ValidationError' },
      },
    },
    delete: {
      tags: ['Organizations'],
      summary: 'Delete an organization',
      description:
        'Requires `organization.delete`.\n\n' +
        'Refuses while the organization still has users — deletion cascades to every user, session and role assignment in the tenant, so it must be deliberate. The caller also cannot delete the organization they belong to.',
      operationId: 'deleteOrganization',
      parameters: [idParam],
      responses: {
        '200': { description: 'Deleted.' },
        '401': { $ref: '#/components/responses/Unauthorized' },
        '403': { description: 'Missing `organization.delete`, or it is your own organization.' },
        '404': notFoundOrOtherTenant,
        '409': { description: 'The organization still has users.' },
      },
    },
  },
};
