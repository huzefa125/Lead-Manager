import { env } from '../config/env';
import { organizationPaths, organizationSchemas } from './organization.paths';
import { rbacPaths, rbacSchemas } from './rbac.paths';

/**
 * OpenAPI 3.0.3 description of the auth API.
 *
 * Hand-written rather than generated from decorators: the spec is the contract
 * frontend and mobile teams code against, and it needs to document things the
 * types cannot express — that the refresh token is never in a response body,
 * that rotation invalidates the previous token, that an unknown email and a
 * wrong password are deliberately indistinguishable.
 *
 * Keep it in step with `auth.validation.ts` when schemas change.
 */

const EXAMPLE_USER = {
  id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
  email: 'ada@example.com',
  name: 'Ada Lovelace',
  isActive: true,
  roles: [
    {
      id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
      name: 'manager',
      displayName: 'Manager',
      description: 'Manages employees and views departments.',
      isSystem: true,
    },
  ],
  permissions: ['department.view', 'employee.create', 'employee.update', 'employee.view'],
  createdAt: '2026-08-14T09:12:33.001Z',
  updatedAt: '2026-08-14T09:12:33.001Z',
};

const EXAMPLE_META = {
  requestId: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
  timestamp: '2026-08-14T09:12:33.114Z',
};

const EXAMPLE_ACCESS_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIzZjI1MDRlMC00Zjg5LTQxZDMtOWEwYy0wMzA1ZTgyYzMzMDEiLCJlbWFpbCI6ImFkYUBleGFtcGxlLmNvbSIsInJvbGUiOiJVU0VSIiwidHlwZSI6ImFjY2VzcyIsImp0aSI6IjJiM2RjYjZkIiwiaWF0IjoxNzcxMDU3MTUzLCJleHAiOjE3NzEwNTgwNTN9.g5xQK0mS8n-VmO9wLpTqNc3rYbXeJdHfA2iUvZs4RkE';

/** Reusable success envelope: `{ success, data, meta }` around any payload. */
const successEnvelope = (dataSchema: object) => ({
  type: 'object',
  required: ['success', 'data', 'meta'],
  properties: {
    success: { type: 'boolean', enum: [true], example: true },
    data: dataSchema,
    meta: { $ref: '#/components/schemas/ResponseMeta' },
  },
});

/** Builds an error response body for a given code/message/status. */
const errorExample = (code: string, message: string, details?: unknown) => ({
  success: false,
  error: { code, message, ...(details ? { details } : {}) },
  meta: EXAMPLE_META,
});

export const openApiDocument = {
  openapi: '3.0.3',

  info: {
    title: 'Auth Service API',
    version: '2.0.0',
    description: [
      'Authentication and role-based access control: registration, login, JWT access',
      'tokens, database-backed rotating refresh tokens, and dynamic RBAC.',
      '',
      '## Multi-tenancy',
      '',
      '**Every user belongs to exactly one organization** — a NOT NULL column, not a',
      'convention. The tenant is a signed claim (`org`) in the access token, never',
      'anything the caller can supply, and every tenant-scoped query filters on it.',
      '',
      'A caller sees only their own organization unless they hold',
      '`organization.manage_all`. Reaching another tenant\'s record returns **404, not',
      '403** — confirming that a record exists elsewhere would itself be a disclosure.',
      '',
      '`POST /auth/register` creates an organization and its first admin together. It',
      'deliberately cannot join an existing organization: an unauthenticated request',
      'must not be able to insert itself into another company\'s tenant.',
      '',
      '## Authorization',
      '',
      'Routes are gated with `authorize("<resource>.<operation>")`. The access token',
      'carries the user\'s effective roles and permissions as signed claims, so both',
      'authentication and authorization run entirely in memory — no database query on',
      'any protected request. Tampering with the claims invalidates the signature.',
      '',
      'Permission matching supports wildcards:',
      '',
      '| Granted | Satisfies |',
      '|---|---|',
      '| `*` | everything, including modules added later |',
      '| `employee.*` | every operation on `employee` |',
      '| `employee.create` | exactly that |',
      '',
      '**Adding a module requires no code change to the authorization layer:** register',
      '`invoice.approve` via `POST /permissions`, grant it to a role, and',
      '`authorize("invoice.approve")` enforces it. Super Admin holds `*`, so it covers',
      'the new capability with no reseed.',
      '',
      '**Permission propagation.** A change reaches a signed-in user at their next',
      'refresh, i.e. within `ACCESS_TOKEN_TTL` (15 minutes). Role assignment through',
      'these APIs deletes the target user\'s sessions in the same transaction, forcing',
      're-authentication so the change applies immediately.',
      '',
      '**Backend enforcement is the only enforcement.** The `permissions` array on a',
      'user is for hiding UI a caller cannot use — never treat a client-side check as',
      'a control.',
      '',
      '## Token model',
      '',
      '| | Access token | Refresh token |',
      '|---|---|---|',
      '| Format | JWT (HS256) | Opaque `uuid.secret` |',
      '| Lifetime | 15 minutes | 7 days |',
      '| Stored server-side | **Never** | Yes — SHA-256 hash only |',
      '| Delivered via | Response body | `httpOnly` cookie |',
      '| Client stores in | Memory (JS state) | Nothing — browser holds it |',
      '| Verified by | Secret key, in memory | Database lookup |',
      '',
      '**Authorization performs no database queries.** The access token is verified',
      'against the secret key in memory on every protected request.',
      '',
      '**The refresh token never appears in a response body.** It is set only as an',
      '`httpOnly; Secure; SameSite=Strict` cookie, so browser JavaScript cannot read it.',
      'An XSS payload can therefore steal at most 15 minutes of access, not a 7-day session.',
      '',
      '**Refresh tokens rotate.** Each call to `/auth/refresh` destroys the presented',
      'token and issues a replacement, so every refresh token is single-use. The',
      'replacement inherits the original expiry — refreshing does not extend a session',
      'beyond 7 days.',
      '',
      '## Response format',
      '',
      'Every response uses one envelope. Branch on `error.code`, never on `error.message`.',
      '',
      '```json',
      '{ "success": true,  "data": { }, "meta": { "requestId": "...", "timestamp": "..." } }',
      '{ "success": false, "error": { "code": "...", "message": "..." }, "meta": { } }',
      '```',
      '',
      '## Trying it out',
      '',
      '1. Call `POST /auth/register` or `POST /auth/login`.',
      '2. Copy `data.accessToken` from the response.',
      '3. Click **Authorize** above and paste it — do not prefix it with `Bearer`.',
      '4. Protected endpoints will now work.',
      '',
      'The refresh cookie is set automatically by the browser, so `/auth/refresh`',
      'and `/auth/logout` work from this page with no further setup.',
    ].join('\n'),
    contact: { name: 'API Support', email: 'support@example.com' },
    license: { name: 'MIT' },
  },

  servers: [
    { url: `http://localhost:${env.PORT}/api`, description: 'Local development' },
    { url: 'https://staging.example.com/api', description: 'Staging' },
    { url: 'https://api.example.com/api', description: 'Production' },
  ],

  tags: [
    {
      name: 'Authentication',
      description: 'Registration, login, token lifecycle and session revocation.',
    },
    {
      name: 'Organizations',
      description:
        'Tenants. Every user belongs to exactly one, and every tenant-scoped query is filtered by it. Only `organization.manage_all` lifts that confinement.',
    },
    {
      name: 'Roles',
      description:
        'Create roles and manage their permissions. Every endpoint is itself permission-gated, so role administration can be delegated like any other capability.',
    },
    {
      name: 'Permissions',
      description:
        'The catalogue of grantable capabilities. Registering a new permission is all that is needed to extend the system to a new module.',
    },
    {
      name: 'Users',
      description: 'List users and manage their role assignments. A user may hold several roles.',
    },
    { name: 'Health', description: 'Liveness and readiness probes.' },
  ],

  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description:
          'Short-lived access token from `/auth/register`, `/auth/login` or `/auth/refresh`. ' +
          'Sent as `Authorization: Bearer <token>`. Verified in memory against the secret key.',
      },
      refreshCookie: {
        type: 'apiKey',
        in: 'cookie',
        name: env.REFRESH_COOKIE_NAME,
        description:
          'Set automatically as an httpOnly cookie on register/login/refresh. ' +
          'Not readable by JavaScript and never returned in a response body.',
      },
    },

    schemas: {
      ResponseMeta: {
        type: 'object',
        required: ['requestId', 'timestamp'],
        description: 'Attached to every response. Quote `requestId` in bug reports.',
        properties: {
          requestId: {
            type: 'string',
            description:
              'Correlation id. Echoed in the `X-Request-Id` header; supply your own to trace a call end to end.',
            example: EXAMPLE_META.requestId,
          },
          timestamp: { type: 'string', format: 'date-time', example: EXAMPLE_META.timestamp },
        },
      },

      User: {
        type: 'object',
        description: 'A user as exposed by the API. The password hash is never included.',
        required: ['id', 'email', 'name', 'isActive', 'roles', 'permissions', 'createdAt', 'updatedAt'],
        properties: {
          id: { type: 'string', format: 'uuid', example: EXAMPLE_USER.id },
          email: { type: 'string', format: 'email', example: EXAMPLE_USER.email },
          name: { type: 'string', nullable: true, example: EXAMPLE_USER.name },
          isActive: { type: 'boolean', example: true },
          roles: {
            type: 'array',
            description:
              'Every role the user holds. Server-assigned — roles sent at registration are ignored.',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', format: 'uuid' },
                name: { type: 'string', example: 'manager' },
                displayName: { type: 'string', example: 'Manager' },
                description: { type: 'string', nullable: true },
                isSystem: { type: 'boolean' },
              },
            },
          },
          permissions: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Effective permissions — the union across every role held, de-duplicated and sorted. Use these for UI visibility only; the backend enforces independently.',
            example: EXAMPLE_USER.permissions,
          },
          createdAt: { type: 'string', format: 'date-time', example: EXAMPLE_USER.createdAt },
          updatedAt: { type: 'string', format: 'date-time', example: EXAMPLE_USER.updatedAt },
        },
        example: EXAMPLE_USER,
      },

      ...rbacSchemas,
      ...organizationSchemas,

      AuthSession: {
        type: 'object',
        description:
          'Returned by register, login and refresh. Note the absence of `refreshToken` — it is delivered only as an httpOnly cookie.',
        required: ['user', 'accessToken', 'tokenType', 'expiresIn'],
        properties: {
          user: { $ref: '#/components/schemas/User' },
          accessToken: {
            type: 'string',
            description: 'JWT. Store in memory (JS state) — never in localStorage.',
            example: EXAMPLE_ACCESS_TOKEN,
          },
          tokenType: { type: 'string', enum: ['Bearer'], example: 'Bearer' },
          expiresIn: {
            type: 'integer',
            description: 'Seconds until the access token expires. Schedule a refresh before this elapses.',
            example: 900,
          },
        },
      },

      RegisterRequest: {
        type: 'object',
        required: ['email', 'password'],
        description: 'Undeclared fields are stripped, so `role` cannot be self-assigned.',
        properties: {
          email: {
            type: 'string',
            format: 'email',
            maxLength: 254,
            description: 'Case-insensitive; stored lowercased.',
            example: 'ada@example.com',
          },
          password: {
            type: 'string',
            minLength: 8,
            description:
              'At least 8 characters with an uppercase letter, a lowercase letter and a digit. Maximum 72 **bytes** — bcrypt truncates beyond that, so longer input is rejected rather than silently cut.',
            example: 'CorrectHorse1',
          },
          name: { type: 'string', minLength: 1, maxLength: 100, example: 'Ada Lovelace' },
        },
      },

      LoginRequest: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email: { type: 'string', format: 'email', example: 'ada@example.com' },
          password: { type: 'string', example: 'CorrectHorse1' },
        },
      },

      RefreshRequest: {
        type: 'object',
        description:
          'Normally empty — the refresh token comes from the cookie. The body field is a fallback for non-browser clients that manage cookies themselves.',
        properties: {
          refreshToken: {
            type: 'string',
            description: 'Optional. Ignored when the cookie is present.',
            example: '3f2504e0-4f89-41d3-9a0c-0305e82c3301.Zm9vYmFyYmF6cXV4',
          },
        },
      },

      MessageResponse: {
        type: 'object',
        required: ['message'],
        properties: { message: { type: 'string', example: 'Logged out successfully' } },
      },

      LogoutAllResponse: {
        type: 'object',
        required: ['message', 'revokedCount'],
        properties: {
          message: { type: 'string', example: 'All sessions revoked' },
          revokedCount: {
            type: 'integer',
            description: 'Number of refresh tokens deleted.',
            example: 3,
          },
        },
      },

      ErrorDetail: {
        type: 'object',
        required: ['field', 'message'],
        properties: {
          field: { type: 'string', example: 'password' },
          message: { type: 'string', example: 'Password must contain an uppercase letter' },
        },
      },

      ErrorResponse: {
        type: 'object',
        required: ['success', 'error', 'meta'],
        properties: {
          success: { type: 'boolean', enum: [false], example: false },
          error: {
            type: 'object',
            required: ['code', 'message'],
            properties: {
              code: {
                type: 'string',
                enum: [
                  'VALIDATION_ERROR',
                  'UNAUTHORIZED',
                  'INVALID_CREDENTIALS',
                  'TOKEN_EXPIRED',
                  'TOKEN_INVALID',
                  'FORBIDDEN',
                  'NOT_FOUND',
                  'CONFLICT',
                  'ACCOUNT_DISABLED',
                  'RATE_LIMITED',
                  'INTERNAL_ERROR',
                ],
                description: 'Stable machine-readable code. Branch on this, not on `message`.',
              },
              message: { type: 'string' },
              details: {
                type: 'array',
                description: 'Present on validation failures — one entry per offending field.',
                items: { $ref: '#/components/schemas/ErrorDetail' },
              },
            },
          },
          meta: { $ref: '#/components/schemas/ResponseMeta' },
        },
      },
    },

    responses: {
      ValidationError: {
        description: 'Request body failed schema validation. Every offending field is listed.',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ErrorResponse' },
            example: errorExample('VALIDATION_ERROR', 'Validation failed', [
              { field: 'email', message: 'Must be a valid email address' },
              { field: 'password', message: 'Password must contain an uppercase letter' },
            ]),
          },
        },
      },
      Unauthorized: {
        description: 'Missing, malformed, expired or forged access token.',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ErrorResponse' },
            examples: {
              missing: {
                summary: 'No token supplied',
                value: errorExample(
                  'UNAUTHORIZED',
                  'Authentication required — provide a Bearer access token',
                ),
              },
              expired: {
                summary: 'Access token expired — call /auth/refresh',
                value: errorExample('TOKEN_EXPIRED', 'Access token has expired'),
              },
              invalid: {
                summary: 'Signature check failed',
                value: errorExample('TOKEN_INVALID', 'Invalid access token'),
              },
            },
          },
        },
      },
      RateLimited: {
        description: 'Too many requests from this IP within the window.',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ErrorResponse' },
            example: errorExample('RATE_LIMITED', 'Too many requests — please try again later'),
          },
        },
      },
      InternalError: {
        description:
          'Unexpected failure. The message is always generic — detail goes to the server logs only, keyed by `meta.requestId`.',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ErrorResponse' },
            example: errorExample('INTERNAL_ERROR', 'An unexpected error occurred'),
          },
        },
      },
    },
  },

  security: [{ bearerAuth: [] }],

  paths: {
    '/auth/register': {
      post: {
        tags: ['Authentication'],
        summary: 'Create an account',
        description:
          'Hashes the password with bcrypt, creates the user, and opens a session. ' +
          'The role is always `USER` — a `role` field in the body is stripped before it reaches the database.',
        operationId: 'register',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/RegisterRequest' },
              examples: {
                full: {
                  summary: 'With display name',
                  value: { email: 'ada@example.com', password: 'CorrectHorse1', name: 'Ada Lovelace' },
                },
                minimal: {
                  summary: 'Email and password only',
                  value: { email: 'grace@example.com', password: 'CorrectHorse1' },
                },
                escalationAttempt: {
                  summary: 'Role injection — silently ignored, user is created as USER',
                  value: { email: 'mallory@example.com', password: 'CorrectHorse1', role: 'ADMIN' },
                },
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Account created and session opened.',
            headers: {
              'Set-Cookie': {
                description: 'The refresh token. httpOnly, so JavaScript cannot read it.',
                schema: {
                  type: 'string',
                  example:
                    'refresh_token=3f2504e0-...; Path=/api/auth; Expires=Thu, 21 Aug 2026 09:12:33 GMT; HttpOnly; SameSite=Strict',
                },
              },
            },
            content: {
              'application/json': {
                schema: successEnvelope({ $ref: '#/components/schemas/AuthSession' }),
                example: {
                  success: true,
                  data: {
                    user: EXAMPLE_USER,
                    accessToken: EXAMPLE_ACCESS_TOKEN,
                    tokenType: 'Bearer',
                    expiresIn: 900,
                  },
                  meta: EXAMPLE_META,
                },
              },
            },
          },
          '409': {
            description: 'Email already registered.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
                example: errorExample('CONFLICT', 'An account with this email already exists'),
              },
            },
          },
          '422': { $ref: '#/components/responses/ValidationError' },
          '429': { $ref: '#/components/responses/RateLimited' },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
    },

    '/auth/login': {
      post: {
        tags: ['Authentication'],
        summary: 'Sign in',
        description:
          'Verifies the password with bcrypt and opens a session.\n\n' +
          'An unknown email and a wrong password return a byte-identical 401, and an unknown ' +
          'email still runs a dummy hash comparison so the two take the same time. Account ' +
          'existence cannot be probed through this endpoint.',
        operationId: 'login',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/LoginRequest' },
              examples: {
                valid: {
                  summary: 'Correct credentials',
                  value: { email: 'ada@example.com', password: 'CorrectHorse1' },
                },
                seededAdmin: {
                  summary: 'Seeded admin (after npm run db:seed)',
                  value: { email: 'admin@example.com', password: 'Admin123!' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Authenticated; session opened.',
            headers: {
              'Set-Cookie': {
                description: 'The refresh token, httpOnly.',
                schema: { type: 'string' },
              },
            },
            content: {
              'application/json': {
                schema: successEnvelope({ $ref: '#/components/schemas/AuthSession' }),
                example: {
                  success: true,
                  data: {
                    user: EXAMPLE_USER,
                    accessToken: EXAMPLE_ACCESS_TOKEN,
                    tokenType: 'Bearer',
                    expiresIn: 900,
                  },
                  meta: EXAMPLE_META,
                },
              },
            },
          },
          '401': {
            description: 'Wrong password, or no such account — deliberately indistinguishable.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
                example: errorExample('INVALID_CREDENTIALS', 'Invalid email or password'),
              },
            },
          },
          '403': {
            description: 'Credentials were correct but the account is disabled.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
                example: errorExample('ACCOUNT_DISABLED', 'This account has been disabled'),
              },
            },
          },
          '422': { $ref: '#/components/responses/ValidationError' },
          '429': { $ref: '#/components/responses/RateLimited' },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
    },

    '/auth/refresh': {
      post: {
        tags: ['Authentication'],
        summary: 'Rotate the session and get a new access token',
        description:
          'Validates the refresh token from the cookie against the database, then issues a new ' +
          'access token **and a new refresh token**. The presented refresh token is deleted in the ' +
          'same transaction, so it can never be used twice.\n\n' +
          'The replacement inherits the original expiry — refreshing keeps a session alive, it does ' +
          'not extend it past `REFRESH_TOKEN_TTL_DAYS`.\n\n' +
          'No `Authorization` header is required; an expired access token is precisely why a client ' +
          'calls this endpoint. On any failure the refresh cookie is cleared.',
        operationId: 'refresh',
        security: [{ refreshCookie: [] }],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/RefreshRequest' },
              examples: {
                browser: { summary: 'Browser — cookie is sent automatically', value: {} },
                nonBrowser: {
                  summary: 'Non-browser client passing the token explicitly',
                  value: { refreshToken: '3f2504e0-4f89-41d3-9a0c-0305e82c3301.Zm9vYmFyYmF6cXV4' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'New access token issued; refresh token rotated.',
            headers: {
              'Set-Cookie': {
                description: 'The replacement refresh token. The previous one is now invalid.',
                schema: { type: 'string' },
              },
            },
            content: {
              'application/json': {
                schema: successEnvelope({ $ref: '#/components/schemas/AuthSession' }),
                example: {
                  success: true,
                  data: {
                    user: EXAMPLE_USER,
                    accessToken: EXAMPLE_ACCESS_TOKEN,
                    tokenType: 'Bearer',
                    expiresIn: 900,
                  },
                  meta: EXAMPLE_META,
                },
              },
            },
          },
          '401': {
            description:
              'Refresh token missing, unknown, expired, or already rotated away. All cases return the same body.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
                examples: {
                  missing: {
                    summary: 'No cookie and no body token',
                    value: errorExample('TOKEN_INVALID', 'Refresh token is required'),
                  },
                  invalid: {
                    summary: 'Unknown, expired, or already used',
                    value: errorExample('TOKEN_INVALID', 'Invalid or expired refresh token'),
                  },
                },
              },
            },
          },
          '403': {
            description: 'Account disabled — every session for the user is deleted.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
                example: errorExample('ACCOUNT_DISABLED', 'This account has been disabled'),
              },
            },
          },
          '429': { $ref: '#/components/responses/RateLimited' },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
    },

    '/auth/me': {
      get: {
        tags: ['Authentication'],
        summary: 'Get the current user',
        description:
          'Returns the authenticated user.\n\n' +
          'Authorization is settled entirely from the access token — signature, expiry, issuer and ' +
          'audience are checked against the secret key in memory, with no database query. The read ' +
          'that happens here is for the response payload, not for the auth decision.',
        operationId: 'getCurrentUser',
        security: [{ bearerAuth: [] }],
        responses: {
          '200': {
            description: 'The authenticated user.',
            content: {
              'application/json': {
                schema: successEnvelope({
                  type: 'object',
                  required: ['user'],
                  properties: { user: { $ref: '#/components/schemas/User' } },
                }),
                example: { success: true, data: { user: EXAMPLE_USER }, meta: EXAMPLE_META },
              },
            },
          },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '404': {
            description: 'Token is valid but the account has since been deleted.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
                example: errorExample('NOT_FOUND', 'User not found'),
              },
            },
          },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
    },

    '/auth/logout': {
      post: {
        tags: ['Authentication'],
        summary: 'Sign out of this session',
        description:
          'Deletes this session\'s refresh token from the database and clears the cookie. ' +
          'The token stops working immediately — this is the guarantee that storing refresh ' +
          'tokens server-side buys.\n\n' +
          'Idempotent: always returns 200, even with a missing or already-invalid token, so a ' +
          'client clearing its credentials can always complete.\n\n' +
          'Any access token already issued stays valid until it expires (at most 15 minutes). ' +
          'Clients should discard it from memory on logout.',
        operationId: 'logout',
        security: [{ refreshCookie: [] }],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/RefreshRequest' },
              examples: { browser: { summary: 'Cookie is sent automatically', value: {} } },
            },
          },
        },
        responses: {
          '200': {
            description: 'Session ended; cookie cleared.',
            content: {
              'application/json': {
                schema: successEnvelope({ $ref: '#/components/schemas/MessageResponse' }),
                example: {
                  success: true,
                  data: { message: 'Logged out successfully' },
                  meta: EXAMPLE_META,
                },
              },
            },
          },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
    },

    '/auth/logout-all': {
      post: {
        tags: ['Authentication'],
        summary: 'Sign out everywhere',
        description:
          'Deletes every refresh token for the authenticated user — all devices and browsers. ' +
          'Use after a password change or a suspected compromise.',
        operationId: 'logoutAll',
        security: [{ bearerAuth: [] }],
        responses: {
          '200': {
            description: 'All sessions revoked.',
            content: {
              'application/json': {
                schema: successEnvelope({ $ref: '#/components/schemas/LogoutAllResponse' }),
                example: {
                  success: true,
                  data: { message: 'All sessions revoked', revokedCount: 3 },
                  meta: EXAMPLE_META,
                },
              },
            },
          },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
    },

    ...organizationPaths,
    ...rbacPaths,

    '/': {
      get: {
        tags: ['Health'],
        summary: 'API index',
        description: 'Lists the available endpoints.',
        operationId: 'apiIndex',
        security: [],
        responses: {
          '200': {
            description: 'Service metadata.',
            content: { 'application/json': { schema: successEnvelope({ type: 'object' }) } },
          },
        },
      },
    },
  },
};

/**
 * Health probes live at the server root, outside `/api`, so they are described
 * separately rather than being given a misleading path in the document above.
 */
export const healthPathsNote =
  'Liveness: GET /health · Readiness (checks Postgres): GET /health/ready';
