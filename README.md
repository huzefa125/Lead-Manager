# Lead Manager API

Multi-tenant lead management built on **Node.js + Express 5 + TypeScript (strict) + PostgreSQL +
Prisma**.

Three layers, each documented in its own section below:

| Layer | What it does |
|---|---|
| **Auth** | Registration, login, JWT access tokens, database-backed rotating refresh tokens, logout |
| **Organizations + RBAC** | Every user belongs to one tenant; roles and permissions are database rows, not code |
| **Lead engine** | Capture from every channel, per-lead journey tracking, and a funnel that names where the journey breaks |

If you read only one thing, read [Lead journey tracking](#lead-journey-tracking) — it explains why
a lead's *stage* and its *journey* are two different things, which is the one design decision the
rest of the module follows from.

---

## Token model

This is the core design decision, so it is worth stating precisely.

| | Access token | Refresh token |
|---|---|---|
| Format | JWT (HS256), signed | Opaque random string (`uuid.secret`) |
| Lifetime | 15 minutes | 7 days |
| Stored server-side | **Never** | Yes — SHA-256 hash only |
| Delivered via | Response body | `httpOnly` `Secure` `SameSite=Strict` cookie |
| Client stores it in | Memory (JS state) | Nothing — the browser holds the cookie |
| Verified by | Secret key, in memory | Database lookup |
| Read on | Every protected request | Only `POST /api/auth/refresh` |
| Reusable | Until expiry | **No — single-use, rotates on every refresh** |

**Authorization performs zero database queries.** [`authenticate`](src/middleware/authenticate.ts)
verifies the JWT's signature, expiry, issuer and audience against the secret key and builds
`req.user` from the token's own claims. No I/O of any kind.

**Refresh tokens are stored because logout has to actually work.** The refresh token is read
once per access-token lifetime — roughly four indexed primary-key lookups per user per hour —
and never on the hot path. What that buys is real revocation: `POST /api/auth/logout` deletes
the row, and the token is dead immediately. Without server-side state, logout could only clear
the cookie, which clears the *browser* but leaves a stolen token valid for its full 7 days with
no way to stop it. The same applies to password changes and account deactivation.

Only a SHA-256 hash of the token's secret half is persisted, so a database dump yields no
usable sessions.

**Refresh tokens rotate.** Every `/refresh` call deletes the presented token and issues a
replacement in the same transaction, so each refresh token works exactly once. A stolen token
is good for at most one exchange and dies the moment the real client next refreshes. The
replacement **inherits the original expiry**, so refreshing in a loop keeps a session alive but
never extends it past the 7-day ceiling — after that, the user signs in again.

### The tradeoff, stated plainly

A user deactivated or deleted mid-session keeps access until their access token expires. That
window is bounded by `ACCESS_TOKEN_TTL` (15 minutes) and closes at their next `/refresh`, which
*does* re-read the user row and kills the session if the account is gone or disabled. Shorten
`ACCESS_TOKEN_TTL` if the window needs to be tighter. If you ever need instant revocation, add a
Redis `jti` blocklist — that is the only correct way to get it, and it is a bolt-on, not a
redesign.

---

## Getting started

```bash
# 1. Install
npm install

# 2. Configure — then edit .env and set real secrets
cp .env.example .env
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"   # run twice

# 3. Database — see options below
docker compose up -d
npx prisma migrate deploy     # or: npm run prisma:migrate  (dev)
npm run db:seed               # optional demo users

# 4. Run
npm run dev                   # http://localhost:4000
```

### Database options

**Docker (portable, recommended for teams)** — `docker compose up -d` uses
[docker-compose.yml](docker-compose.yml) and needs no local Postgres.

**Native PostgreSQL install** — if Postgres is installed but has no initialized cluster (no
registered service, nothing on 5432), create one. Keep the data directory **outside any
OneDrive/Dropbox folder** — sync clients corrupt live database files.

```powershell
$PG   = "C:\Program Files\PostgreSQL\18\bin"
$DATA = "$env:LOCALAPPDATA\auth-service-pg\data"

# One-time: initialize the cluster (sets the postgres password to "postgres")
"postgres" | Out-File -Encoding ascii "$env:TEMP\pw.txt"
& "$PG\initdb.exe" -D $DATA -U postgres --auth-host=scram-sha-256 --auth-local=trust `
                   --pwfile="$env:TEMP\pw.txt" -E UTF8
Remove-Item "$env:TEMP\pw.txt"

# One-time: create the database
& "$PG\pg_ctl.exe" -D $DATA -l "$env:LOCALAPPDATA\auth-service-pg\server.log" -o "-p 5432" start
$env:PGPASSWORD = "postgres"; & "$PG\createdb.exe" -h 127.0.0.1 -U postgres -w auth_db

# Every day
& "$PG\pg_ctl.exe" -D $DATA -l "$env:LOCALAPPDATA\auth-service-pg\server.log" start   # start
& "$PG\pg_ctl.exe" -D $DATA stop                                                       # stop
```

Server log: `%LOCALAPPDATA%\auth-service-pg\server.log`. `GET /health/ready` confirms the app
can actually reach the database.

`src/config/env.ts` validates every variable at boot with Zod and exits with a readable list of
problems if anything is missing — including a check that the two JWT secrets differ.

### Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Watch-mode dev server (tsx) |
| `npm run build` | Generate Prisma client + compile to `dist/` |
| `npm start` | Run the compiled build |
| `npm run typecheck` | `tsc --noEmit` across src and tests |
| `npm test` | Unit suite — no database required |
| `npm run test:integration` | Full HTTP suite against a real Postgres |
| `npm run prisma:migrate` | Create/apply a dev migration |
| `npm run db:seed` | Seed demo users |

---

## API

Base URL `/api`. Every response — success or failure — uses one envelope:

```jsonc
// success
{ "success": true, "data": { ... }, "meta": { "requestId": "...", "timestamp": "..." } }

// failure
{ "success": false,
  "error": { "code": "VALIDATION_ERROR", "message": "Validation failed",
             "details": [{ "field": "password", "message": "..." }] },
  "meta": { "requestId": "...", "timestamp": "..." } }
```

| Method | Endpoint | Auth | Permission | Purpose |
|---|---|---|---|---|
| `POST` | `/api/auth/register` | — | — | Create organization + first admin, open session |
| `POST` | `/api/auth/login` | — | — | Authenticate, open session |
| `POST` | `/api/auth/refresh` | refresh cookie | — | New access token + rotated refresh token |
| `POST` | `/api/auth/logout` | refresh cookie | — | Delete this session |
| `POST` | `/api/auth/logout-all` | Bearer | — | Delete all sessions |
| `GET` | `/api/auth/me` | Bearer | — | Current user, roles and permissions |
| `GET` | `/api/organizations/current` | Bearer | — | The caller's own tenant |
| `GET` | `/api/organizations` | Bearer | `organization.view` | List (tenant-confined) |
| `POST` | `/api/organizations` | Bearer | `organization.create` | Create a tenant |
| `GET` | `/api/organizations/:id` | Bearer | `organization.view` | Get a tenant |
| `PATCH` | `/api/organizations/:id` | Bearer | `organization.update` | Update a tenant |
| `DELETE` | `/api/organizations/:id` | Bearer | `organization.delete` | Delete a tenant |
| `GET` | `/api/roles` | Bearer | `role.view` | List roles |
| `POST` | `/api/roles` | Bearer | `role.create` | Create a role |
| `GET` | `/api/roles/:id` | Bearer | `role.view` | Get a role |
| `PATCH` | `/api/roles/:id` | Bearer | `role.update` | Update label/description |
| `DELETE` | `/api/roles/:id` | Bearer | `role.delete` | Delete a role |
| `PUT` | `/api/roles/:id/permissions` | Bearer | `role.update` | Replace grants |
| `POST` | `/api/roles/:id/permissions` | Bearer | `role.update` | Add grants |
| `DELETE` | `/api/roles/:id/permissions` | Bearer | `role.update` | Revoke grants |
| `GET` | `/api/permissions` | Bearer | `permission.view` | List permissions |
| `POST` | `/api/permissions` | Bearer | `permission.create` | Register a capability |
| `GET` | `/api/permissions/:id` | Bearer | `permission.view` | Get a permission |
| `PATCH` | `/api/permissions/:id` | Bearer | `permission.update` | Update description |
| `DELETE` | `/api/permissions/:id` | Bearer | `permission.delete` | Delete a permission |
| `GET` | `/api/users` | Bearer | `user.view` | List users |
| `GET` | `/api/users/:id` | Bearer | `user.view` | Get a user |
| `PUT` | `/api/users/:id/roles` | Bearer | `role.assign` | Replace a user's roles |
| `POST` | `/api/users/:id/roles` | Bearer | `role.assign` | Assign roles |
| `DELETE` | `/api/users/:id/roles` | Bearer | `role.assign` | Remove roles |
| `POST` | `/api/leads/capture` | Bearer | `lead.capture` | **Integration entry point** — capture from any channel |
| `GET` | `/api/leads/funnel` | Bearer | `lead.view` | The journey funnel + where it breaks |
| `GET` | `/api/leads/leakage` | Bearer | `lead.view` | Which open leads are rotting right now, and how much value is at risk |
| `GET` | `/api/leads/response-times` | Bearer | `lead.view` | Six response-time gaps, per salesperson, and whether slow contact costs deals |
| `GET` | `/api/leads/follow-ups` | Bearer | `lead.view` | The daily dashboard — follow-ups due today, overdue, and critical |
| `GET` | `/api/leads` | Bearer | `lead.view` | List, filter, search |
| `POST` | `/api/leads` | Bearer | `lead.create` | Create manually or by import |
| `GET` | `/api/leads/:id` | Bearer | `lead.view` | Get a lead |
| `PATCH` | `/api/leads/:id` | Bearer | `lead.update` | Edit details — **not** stage, owner or status |
| `DELETE` | `/api/leads/:id` | Bearer | `lead.delete` | Delete a lead and its timeline |
| `PUT` | `/api/leads/:id/assignment` | Bearer | `lead.assign` | Assign / unassign |
| `PUT` | `/api/leads/:id/stage` | Bearer | `lead.update` | Move between stages |
| `GET` | `/api/leads/:id/timeline` | Bearer | `lead.view` | Complete history |
| `POST` | `/api/leads/:id/activities` | Bearer | `lead.update` | Log a call, email, meeting, quotation |
| `GET` | `/api/lead-sources` | Bearer | `lead_source.view` | List sources |
| `POST` | `/api/lead-sources` | Bearer | `lead_source.create` | Add a source |
| `GET` | `/api/lead-sources/:id` | Bearer | `lead_source.view` | Get a source |
| `PATCH` | `/api/lead-sources/:id` | Bearer | `lead_source.update` | Rename / deactivate |
| `DELETE` | `/api/lead-sources/:id` | Bearer | `lead_source.delete` | Delete a source |
| `GET` | `/api/lead-stages` | Bearer | `lead_stage.view` | List pipeline stages |
| `POST` | `/api/lead-stages` | Bearer | `lead_stage.create` | Add a stage |
| `GET` | `/api/lead-stages/:id` | Bearer | `lead_stage.view` | Get a stage |
| `PATCH` | `/api/lead-stages/:id` | Bearer | `lead_stage.update` | Rename / reorder |
| `DELETE` | `/api/lead-stages/:id` | Bearer | `lead_stage.delete` | Delete a stage |
| `GET` | `/health` | — | — | Liveness |
| `GET` | `/health/ready` | — | — | Readiness (checks Postgres) |

### Register / Login

```http
POST /api/auth/register
Content-Type: application/json

{ "email": "user@example.com", "password": "CorrectHorse1", "name": "Ada" }
```

```jsonc
// 201 — plus Set-Cookie: refresh_token=...; HttpOnly; SameSite=Strict; Path=/api/auth
{
  "success": true,
  "data": {
    "user": { "id": "...", "email": "user@example.com", "name": "Ada",
              "role": "USER", "isActive": true, "createdAt": "...", "updatedAt": "..." },
    "accessToken": "eyJhbGciOiJIUzI1NiIs...",
    "tokenType": "Bearer",
    "expiresIn": 900
  },
  "meta": { ... }
}
```

The response body contains **no refresh token**. It exists only in the cookie, so an XSS payload
can steal at most 15 minutes of access rather than a 7-day session.

### Protected requests

```http
GET /api/auth/me
Authorization: Bearer <accessToken>
```

### Refresh

```http
POST /api/auth/refresh
Cookie: refresh_token=<token>
```

No `Authorization` header — an expired access token is precisely why a client calls this.
Returns a new `accessToken` **and a new refresh cookie**. The token you sent is now dead; use
the replacement from `Set-Cookie` on the next call. Browsers handle this automatically.

---

## Interactive docs (Swagger)

With the server running:

- **Swagger UI** — <http://localhost:4000/api/docs>
- **Raw OpenAPI 3.0.3 spec** — <http://localhost:4000/api/docs.json>

The spec ([src/docs/openapi.ts](src/docs/openapi.ts)) is hand-written rather than generated,
because the contract includes things types cannot express: that the refresh token is never in a
response body, that rotation invalidates the previous token, and that an unknown email is
deliberately indistinguishable from a wrong password. Every endpoint carries realistic request
and response examples, including the failure cases.

To try a protected endpoint: call `/auth/register` or `/auth/login`, copy `data.accessToken`,
click **Authorize**, and paste it — without a `Bearer` prefix. The refresh cookie is set by the
browser automatically, so `/auth/refresh` and `/auth/logout` work with no extra setup.

`docs.json` imports directly into Postman or Insomnia, and feeds client generators
(`openapi-generator`, `orval`) for typed frontend clients.

Set `ENABLE_API_DOCS=false` to disable both routes — worth considering in production, since the
spec is a complete map of every endpoint and its validation rules.

### Error codes

`VALIDATION_ERROR` (422) · `INVALID_CREDENTIALS` (401) · `UNAUTHORIZED` (401) ·
`TOKEN_EXPIRED` (401) · `TOKEN_INVALID` (401) · `ACCOUNT_DISABLED` (403) · `FORBIDDEN` (403) ·
`NOT_FOUND` (404) · `CONFLICT` (409) · `RATE_LIMITED` (429) · `INTERNAL_ERROR` (500)

Branch on `error.code`, never on `error.message`.

---

## Project structure

```
src/
├── config/          env validation (Zod), Prisma client, logger
├── auth/            routes, controller, service, token service/repository,
│                    Zod schemas, cookie handling
├── organizations/   tenants — repository, service, controller, routes
├── rbac/            roles, permissions, user-role assignment
│                    permission.constants.ts — the catalogue (edit to add a module)
├── leads/           the lead engine
│                    lead.milestones.ts  — the journey rules + funnel maths (pure)
│                    lead.service.ts     — leads, assignment, stage moves
│                    activity.service.ts — the timeline
│                    catalog.service.ts  — sources and stages
│                    funnel.service.ts   — reporting
│                    lead-leakage.ts     — leakage rules + duplicate/silent-source detection (pure)
│                    leakage.service.ts  — leakage report assembly + headlines
│                    response-time.ts    — response-time gaps, ranking, loss correlation (pure)
│                    response-time.service.ts — response-time report assembly + headlines
│                    follow-up.ts        — the follow-up state machine (pure)
│                    follow-up.service.ts — follow-up dashboard assembly
├── users/           repository, service, serializer, types
├── middleware/      authenticate, authorize, validate, error-handler,
│                    rate-limit, request-id, not-found
├── utils/           ApiError, response envelope, jwt, password, crypto, duration
│                    permissions.ts — the authorization decision
│                    tenant.ts      — the tenant-isolation decision
├── docs/            OpenAPI spec + Swagger UI router
├── routes/          API router — new feature routers mount here
├── types/           Express request augmentation
├── app.ts           builds the app (no listener — tests drive this directly)
└── server.ts        lifecycle: boot, graceful shutdown
```

Layering is one-directional: `routes → controller → service → repository → Prisma`.
Controllers do no business logic; services never touch `req`/`res`.

---

## Security measures

- **bcrypt** (cost 12) with per-password salts. Input is rejected past 72 bytes rather than
  silently truncated, measured in **bytes** — 18 emoji hit that limit.
- **No password hash ever leaves the API.** [`toPublicUser`](src/users/user.serializer.ts) picks
  fields explicitly, so a column added later is excluded by default. Pinned by a test.
- **Account enumeration guards.** An unknown email runs a dummy bcrypt comparison so it costs
  the same time as a wrong password, and both return a byte-identical 401. The `isActive` check
  runs *after* the password check, so a disabled account is not revealed to a stranger.
- **Timing-safe** constant-time comparison of refresh token hashes.
- **Single-use refresh tokens.** Rotation on every refresh caps the value of a stolen token at
  one exchange. Rotation is transactional, so a crash cannot leave a user with two live tokens
  or none.
- **Mass-assignment safe.** Zod strips undeclared fields, so `{"role": "ADMIN"}` in a
  registration body is discarded. Covered by a test.
- **Rate limiting** — a global limit plus a stricter one on credential endpoints, with
  `skipSuccessfulRequests` so a legitimate user behind a shared NAT is not punished.
- **Error handling that cannot leak.** Unrecognised errors never have their message returned;
  they collapse to a generic 500 and the detail goes to the logs only. Prisma `P2002`/`P2025` and
  JWT errors are mapped to correct status codes. Stack traces are never in production output.
- **helmet**, CORS with an explicit origin allowlist, 10 kb body cap, `x-powered-by` disabled.
- **Log redaction** for `authorization`, `cookie`, `set-cookie`, and any `password*`/`*token`
  field, as a safety net.
- **`trust proxy` defaults off** — enabling it blindly lets clients spoof `X-Forwarded-For` and
  evade rate limiting.

---

## Organizations (multi-tenancy)

**Every user belongs to exactly one organization.** That is a `NOT NULL` foreign key, not a
convention — a user with no tenant could not be scoped by any query, so the invariant is
enforced by the column.

```
Organization ──< User ──< UserRole >── Role ──< RolePermission >── Permission
```

### How isolation works

The tenant is a **signed claim** (`org`) in the access token — never anything the caller can
supply, since a client-supplied organization id would be a trivial cross-tenant read. Every
tenant-scoped query filters on it through one small module,
[`src/utils/tenant.ts`](src/utils/tenant.ts), so the rule cannot drift between call sites.

A caller sees only their own organization **unless they hold `organization.manage_all`**. Super
Admin satisfies that through its `*` grant, so platform administrators work across tenants with
no special case in the code.

**Cross-tenant access returns 404, not 403.** Confirming that a record exists in an organization
you cannot see is itself a disclosure; from outside the tenant, the resource is
indistinguishable from one that never existed.

### Registration creates a tenant

`POST /api/auth/register` creates the organization and its first user **in one transaction** —
a failed user insert cannot leave an orphan organization behind. The founder becomes `admin` of
that organization, because a brand new tenant with nobody able to administer it would be
useless.

```jsonc
POST /api/auth/register
{ "email": "ada@acme.com", "password": "CorrectHorse1", "organizationName": "Acme Corporation" }
// → organization "Acme Corporation" (slug "acme-corporation"), user is its admin
```

`organizationName` is optional — omitted, a personal organization is derived from the name or
email, so no account can exist outside one. Colliding names get a numeric slug suffix
(`acme-corporation-2`).

**Registration deliberately cannot join an existing organization.** Letting an unauthenticated
request insert itself into another company's tenant would be a serious hole. Adding people to an
existing organization is an authenticated, permission-gated operation.

The founder is admin of *their own* tenant only — they do **not** get `organization.manage_all`
or `*`. There are tests pinning that.

### Endpoints

| Method | Endpoint | Permission | Notes |
|---|---|---|---|
| `GET` | `/api/organizations/current` | *(authenticated)* | Every user may see their own tenant |
| `GET` | `/api/organizations` | `organization.view` | One row, unless `manage_all` |
| `POST` | `/api/organizations` | `organization.create` | Platform operation |
| `GET` | `/api/organizations/:id` | `organization.view` | 404 across tenants |
| `PATCH` | `/api/organizations/:id` | `organization.update` | `isActive` needs `manage_all` |
| `DELETE` | `/api/organizations/:id` | `organization.delete` | Refuses while it has users |

### Tenant safety rails

- **`slug` is immutable** — it may appear in URLs and integrations.
- **Deactivating a tenant requires `organization.manage_all`.** It blocks sign-in for every user
  in it, including the caller, so a tenant admin must not be able to lock their own organization
  out with no route back in. Suspension is enforced at both login *and* refresh, so an
  already-signed-in user loses access at their next refresh rather than lingering.
- **An organization with users cannot be deleted** — deletion cascades to every user, session
  and role assignment in it. And you cannot delete the organization you belong to.
- **Roles cannot be assigned across tenants.** The target is loaded through the tenant-aware
  lookup first, so it reads as 404 from outside.

### Seeded tenants

Three on purpose — with everyone in one organization, a broken tenant filter would still look
correct.

| Tenant | Users |
|---|---|
| `platform` | `superadmin@example.com` — the only account with `organization.manage_all` |
| `acme` | `admin@example.com`, `manager@example.com`, `user@example.com` |
| `globex` | `globex.admin@example.com` — a full admin, still confined to Globex |

The seed also gives `acme` a **demo pipeline of 127 leads** shaped like a real funnel — 127
captured, 89 contacted, 54 replied, 31 meetings, 18 quotations, 7 won, spread over 90 days and
across every source, with a quarter left unassigned. A funnel where every lead converts
demonstrates nothing; the interesting number is the 38 that are never contacted at all. Sign in as
`admin@example.com` and call `GET /api/leads/funnel`.

---

## RBAC

Authorization is **data-driven**: roles and permissions are database rows, not enum values or
code constants. Adding a module never requires touching the authorization logic.

```ts
router.post('/employees', authenticate, authorize('employee.create'), controller);
```

`authenticate` establishes *who* the caller is; `authorize` decides *whether they may*. Both
run entirely in memory.

### Data model

```
User ──< UserRole >── Role ──< RolePermission >── Permission
```

| Table | Purpose |
|---|---|
| `roles` | Named permission bundles (`super_admin`, `admin`, `manager`, `user`) |
| `permissions` | Grantable capabilities, addressed `resource.operation` |
| `user_roles` | Many-to-many — **a user may hold several roles** |
| `role_permissions` | Many-to-many — grants |

Both join tables use composite primary keys, so a duplicate assignment is impossible at the
database level, and cascade on delete so no dangling grant can survive.

A user's **effective permissions** are the union across every role they hold, de-duplicated and
sorted.

### Permission format and wildcards

| Granted | Satisfies |
|---|---|
| `*` | Everything — including modules that do not exist yet |
| `employee.*` | Every operation on `employee` |
| `employee.create` | Exactly that |

Wildcards are ordinary permission rows, not special cases in code. The entire authorization
decision is [`matchesPermission`](src/utils/permissions.ts) — a pure function that knows the
name of no resource and no operation.

`employee.*` deliberately does **not** match `employee_record.view`; matching is on the parsed
resource, not a string prefix.

### Super Admin

Holds the single permission `*`. That is what makes it correct for modules added next year with
no reseed and no migration. It is protected in two ways: its grants cannot be modified, and it
cannot be deleted — otherwise an administrator could strip it and lock everyone out of the RBAC
APIs with no in-app recovery.

### No database query on the hot path

The access token carries the user's roles and effective permissions as **signed claims**, so
`authorize()` reads `req.user.permissions` from the verified token. Tampering with the claims
invalidates the signature, so a client cannot grant itself a permission.

**Propagation.** A permission change reaches a signed-in user at their next refresh — within
`ACCESS_TOKEN_TTL` (15 minutes). Role assignment through the API deletes that user's refresh
tokens **in the same transaction** as the assignment change, forcing re-authentication so the
change applies immediately rather than waiting out the TTL.

### Adding a new module

No deployment, no change to the authorization logic:

```bash
# 1. Register the capability
POST /api/permissions   { "action": "invoice.approve" }

# 2. Grant it to a role
POST /api/roles/{id}/permissions   { "permissions": ["invoice.approve"] }
```

```ts
// 3. Gate the route
router.post('/invoices/:id/approve', authenticate, authorize('invoice.approve'), controller);
```

Super Admin covers the new permission the moment it exists. There is an integration test that
walks exactly this sequence end to end.

### Middleware reference

| Helper | Semantics |
|---|---|
| `authorize('a', 'b')` | Holds **any** of them (OR) |
| `authorizeAll('a', 'b')` | Holds **every** one (AND) |
| `requireRole('admin')` | Membership check — prefer `authorize()`, which survives role reorganisation |

`authorize()` throws at startup if called with no arguments, since an unqualified gate would
silently admit everyone. It returns **403** when the caller is authenticated but lacks the
permission, and **401** when there is no authenticated user — the distinction tells a client
whether to re-authenticate or show an error. The 403 message names the missing permission, so
an administrator knows exactly what to grant.

### Seeded roles

| Role | Permissions |
|---|---|
| `super_admin` | `*` — the only role with `organization.manage_all` |
| `admin` | `organization.view/update`, `user.*`, `employee.*`, `department.*`, `lead.*`, `lead_source.*`, `lead_stage.*`, `role.view`, `role.assign`, `permission.view` — **confined to its own tenant** |
| `manager` | `organization.view`, `user.view`, `employee.view/create/update`, `department.view`, `lead.view/create/update/assign`, `lead_source.view`, `lead_stage.view` |
| `user` | `employee.view`, `department.view`, `lead.view`, `lead_source.view`, `lead_stage.view` |

`manager` is the **salesperson role**: it works the pipeline but cannot reshape it, because renaming
a stage rewrites how every report in the organization reads. `user` stays read-only; a salesperson
who must log calls needs `manager`, or a custom role with `lead.update` — created through the API,
since roles are rows.

Note that `lead.*` covers neither `lead_source.view` nor `lead_stage.view`: matching is on the
parsed resource, not a string prefix. That is what lets "work the pipeline" and "configure the
pipeline" be granted separately.

`admin` deliberately excludes `organization.manage_all`, which is what keeps a tenant
administrator inside their own organization while still being a full admin of it.

| Seeded login | Password | Tenant |
|---|---|---|
| `superadmin@example.com` | `SuperAdmin123!` | `platform` |
| `admin@example.com` | `Admin123!` | `acme` |
| `manager@example.com` | `Manager123!` | `acme` |
| `user@example.com` | `User1234!` | `acme` |
| `globex.admin@example.com` | `Globex123!` | `globex` |

### RBAC safety rails

- **Registration cannot set roles.** Zod strips undeclared fields, and the default role is
  resolved server-side. Covered by a test that posts `{"roles": ["super_admin"]}`.
- **Self-demotion is blocked** — an administrator cannot remove their own admin roles.
- **System roles and permissions cannot be deleted.**
- **A role still assigned to users cannot be deleted**, and a permission still granted to a role
  cannot be deleted — reassign first, so nobody silently loses access.
- **Unknown actions are rejected, not ignored.** Granting `["employee.view", "typo.oops"]`
  returns 422 naming `typo.oops`, rather than creating a role weaker than requested.
- **Role names are immutable.** They are referenced by seeds and code; renaming one would
  silently break authorization.
- **All grant changes are transactional** — an observer sees the old set or the new one, never
  a window in which the role grants nothing.

### Frontend note

The `permissions` array returned with a user is for **UI visibility only** — hiding buttons a
caller cannot use. It is not a control. Every check is enforced server-side, and the API returns
403 regardless of what the client believes.

---

## Lead Engine

```
Organization ──< LeadSource ──< Lead >── LeadStage
                                 │
                                 ├──< LeadActivity   (the timeline)
                                 └──── assignedTo → User
```

### Lead capture — the unified inbox

One endpoint, every channel:

```http
POST /api/leads/capture
Authorization: Bearer <token>

{
  "channel": "WHATSAPP",
  "firstName": "Ravi",
  "phone": "+91 90000 11111",
  "company": "Vertex Logistics",
  "externalId": "wa-88213",
  "campaign": "diwali-2026",
  "utmSource": "whatsapp",
  "utmMedium": "social",
  "landingPage": "https://acme.example.com/quote"
}
```

Channels: `WEBSITE_FORM` `WHATSAPP` `INSTAGRAM` `FACEBOOK` `GOOGLE_ADS` `LINKEDIN` `EMAIL`
`PHONE` `CRM_IMPORT` `BOOKING` `REFERRAL` `MANUAL` `OTHER`.

**Capture cannot set a stage, an owner or a status.** Zod strips them. Every captured lead starts
at the top of the pipeline, because the funnel's first number only means "leads received" if
nothing can enter halfway down.

**Capture will not create the same person twice.** Three outcomes, reported in `outcome`:

| `outcome` | Status | When |
|---|---|---|
| `created` | 201 | A new lead |
| `duplicate_external_id` | 200 | Same source + `externalId` — a redelivered webhook |
| `merged_into_open_lead` | 200 | An open lead already has this email or phone |

A merge fills blanks only — a later form that omits the company must not erase the company someone
typed by hand — and is recorded as an **internal note, not an inbound reply**. Filling a form again
is not a response to your outreach, and counting it as one would inflate the reply rate.

Closed leads are excluded from duplicate matching: someone who was lost six months ago and comes
back is a new opportunity, not a continuation of the old one.

### Lead source tracking

Every lead carries its full attribution:

| | |
|---|---|
| **Source** | A tenant-owned row, not an enum — `google_ads_brand` and `google_ads_competitor` are two sources over one channel |
| **Channel** | The enum above, on the source |
| **Campaign** | Free text |
| **Landing page** | Full URL |
| **UTM** | `source` `medium` `campaign` `term` `content` |
| **Referrer** | Full URL |
| **Captured at** | When the lead *arrived* — not when the row was written, so imports and replayed webhooks land on the right day |
| **Assigned salesperson** | Nullable; `SET NULL` on user deletion, so a salesperson leaving never deletes pipeline |
| **Company + contact** | Name, email, phone, WhatsApp (kept apart from phone — often a different number), job title, website |
| **Estimated deal value** | `DECIMAL(14,2)` + ISO currency. Decimal, not float: money summed in binary floating point eventually reports a total nobody can reconcile |

Sources and stages are **provisioned per organization on first use** (`ensureDefaults`), and
backfilled for existing tenants by the migration. `createMany({ skipDuplicates })` against the
`(organization_id, key)` unique index makes it idempotent and race-safe — two simultaneous first
captures cannot produce two sets of stages.

### Lead journey tracking

This is the core of the module.

```
Lead Created → Assigned → First Contact → Reply Received → Meeting Booked
             → Quotation Sent → Follow-up → Won / Lost
```

**A lead's stage and its journey are two different things.**

*Stage* is where the lead is now, and it moves in **both** directions — a deal that reaches
"Quotation Sent" and goes quiet gets dragged back to "Follow-up". *Journey milestones* are
write-once columns on the lead, stamped the first time it reaches each point and never cleared.

That distinction is the whole design. A funnel counted from current stage reports that the
quotation was never sent the moment a salesperson honestly moves a stalled deal backwards — so the
numbers shrink as the data gets more accurate. Milestones make the count monotonic:

| Column | Set by |
|---|---|
| `capturedAt` | Capture. Every other milestone is clamped to be no earlier than this |
| `assignedAt` | First owner. **Not cleared by unassigning** — the lead did once have an owner |
| `firstContactAt` | An **outbound** call/email/WhatsApp/SMS, or a follow-up |
| `firstReplyAt` | An **inbound** call/email/WhatsApp/SMS |
| `meetingBookedAt` | A `MEETING` activity, or the `meeting` stage |
| `quotationSentAt` | A `QUOTATION` activity, the `quotation` stage, or winning |
| `lastFollowUpAt` | Latest, not first — this one tracks recency, so "no follow-up in 7 days" is answerable |
| `closedAt` | Won or lost. Cleared on reopen |

**`direction` is required, never inferred.** It carries the entire distinction between "we reached
out" and "they answered". Without it those two are the same row and the reply rate — the funnel's
most diagnostic number — cannot be computed at all.

**Reaching a milestone backfills every earlier one.** A lead can book a meeting straight off a
Calendly link with no logged call. Recording only `meetingBookedAt` would make meetings outnumber
contacts, and a funnel that goes *up* in the middle cannot be read — a negative drop-off is not a
number anyone can act on. So the chain is monotonic by construction, not by hoping the data
behaves.

A `NOTE` is deliberately excluded: writing a note to yourself is not contact, and counting it would
inflate the top of the funnel with work that never left the building.

The rules live in [`src/leads/lead.milestones.ts`](src/leads/lead.milestones.ts) — pure functions
over plain values, no Prisma, no I/O. They are the part of this module most likely to be argued
about, and an argument is only settled by a test that runs in milliseconds.

### Lead timeline

```http
GET /api/leads/{id}/timeline?order=asc
GET /api/leads/{id}/timeline?excludeSystem=true    # only human-logged work
```

User-logged work and system events share one table. A timeline assembled from two sources has to
be merged and paginated in application code, and would drift out of order the first time a clock
disagreed.

| Logged by a user | Written by the system |
|---|---|
| `NOTE` `CALL` `EMAIL` `WHATSAPP` `SMS` `MEETING` `QUOTATION` `FOLLOW_UP` `TASK` | `CREATED` `ASSIGNED` `STAGE_CHANGED` `STATUS_CHANGED` |

The system types are **rejected by the validation schema** — a client able to forge a
`STAGE_CHANGED` entry would make the audit trail worthless. System entries carry structured
`metadata`: the stage moved from and to, the previous and new owner.

**Every mutation writes its timeline entry in the same transaction as the change.** If the pipeline
moved and nobody can see who moved it or when, the history is decoration rather than an audit —
and the funnel built on top of it cannot be trusted either.

Logging an activity returns the milestones it moved:

```jsonc
// POST /api/leads/{id}/activities  { "type": "CALL", "direction": "OUTBOUND" }
{ "activity": { ... }, "lead": { ... }, "advanced": ["firstContactAt"] }
```

so the UI can say "this lead is now counted as contacted" instead of leaving the user to spot a
number changing elsewhere on the screen.

### The funnel — where the journey breaks

```http
GET /api/leads/funnel?capturedFrom=2026-06-01&groupBy=source
```

```jsonc
{
  "totals": { "captured": 127, "won": 7, "lost": 36, "assigned": 103, "unassigned": 24,
              "winRate": 0.1628, "wonValue": 812000 },
  "funnel": [
    { "key": "captured",  "label": "Leads received",  "count": 127, "droppedFromPrevious": 0  },
    { "key": "contacted", "label": "Contacted",       "count": 89,  "droppedFromPrevious": 38 },
    { "key": "replied",   "label": "Replied",         "count": 54,  "droppedFromPrevious": 35 },
    { "key": "meeting",   "label": "Meetings booked", "count": 31,  "droppedFromPrevious": 23 },
    { "key": "quotation", "label": "Quotations sent", "count": 18,  "droppedFromPrevious": 13 },
    { "key": "won",       "label": "Closed won",      "count": 7,   "droppedFromPrevious": 11 }
  ],
  "break": {
    "fromLabel": "Leads received", "toLabel": "Contacted", "dropped": 38, "dropOffRate": 0.2992,
    "summary": "38 of 127 leads (29.9%) stop between \"Leads received\" and \"Contacted\" — the largest loss in the journey."
  },
  "responseTimes": { "medianHoursToFirstContact": 8.2, "medianHoursToFirstReply": 19.5 }
}
```

**`break` is ranked by leads lost, not by rate.** A 100% drop-off across the two leads that reached
quotation is real but unactionable next to 38 leads lost before anyone called them. Ties go to the
earlier step, since fixing an early leak also feeds every step after it. It is `null` when nothing
was lost anywhere — including the empty case, where inventing a break would be worse than saying
nothing.

**Assignment is reported in `totals`, not as a funnel step.** A lead can be worked while unassigned
and assigned while untouched, so folding it into the chain would let a bookkeeping change fabricate
progress. `unassigned` is a real leak that the six steps do not show.

**`winRate` divides by leads that reached a decision** (won ÷ (won + lost)), not by everything
captured — otherwise it falls every time marketing has a good month.

`groupBy=source|channel|owner` splits the same report, each group with its own break.

**Cost.** The funnel is four indexed aggregates over the milestone columns. Nothing replays the
activity table, so the cost of a report does not grow with how hard the team has been working.

### Lead leakage detection

```http
GET /api/leads/leakage?sourceId=...
Authorization: Bearer <token>
```

The funnel says how far leads got. This says **which open leads are quietly rotting right now**,
and how much pipeline value sits behind them — the number a sales manager actually needs on a
Monday morning:

```jsonc
{
  "summary": { "totalOpenLeadsAtRisk": 41, "totalAtRiskValue": 840000, "currency": "INR" },
  "headlines": [
    "🔴 23 leads have had no follow-up for 5+ days",
    "🔴 6 quotes were sent with no follow-up in 3+ days",
    "🔴 4 leads were assigned but never contacted (48+ hours)",
    "🔴 ₹8.4L estimated pipeline is currently at risk"
  ]
}
```

**Eight rules, run against every open lead:**

| Rule | Flags when | Default threshold |
|---|---|---|
| Assigned, never contacted | `assignedAt` set, `firstContactAt` still null | 48 hours |
| Contacted too late | `firstContactAt − capturedAt` exceeds the threshold | 24 hours |
| No follow-up after contact | Contacted, then nothing logged since | 5 days |
| Quote sent, no follow-up | `quotationSentAt` set, nothing logged since | 3 days |
| Meeting, no next step | Met, no quotation, nothing logged since | 3 days |
| Hot lead gone cold | Replied *and* was followed up at least once, then silence | 4 days |
| Stuck with salesperson | Owned, hasn't changed stage in a long time | 10 days |
| Marked lost, no reason | `status = LOST`, `lostReason` empty | — |

Plus two checks that aren't per-lead thresholds:

- **Duplicate leads** — open leads sharing an email, phone or WhatsApp number. Capture already
  merges duplicates on the way in (`findOpenDuplicate`); this catches what got past it —
  `POST /leads` (the manual/import path) does not dedupe, on purpose, since an import legitimately
  knows things capture cannot.
- **Silent sources** — an active lead source that has captured leads before but not recently.

**Every threshold is overridable per request** (`?noFollowUpDays=3`), and every rule fires
independently — a lead can trip several at once. `summary.totalOpenLeadsAtRisk` and
`totalAtRiskValue` are de-duplicated across all of them, so a lead counted by three rules is
still one lead and one value. `late_first_contact` and `lost_without_reason` are historical/hygiene
signals rather than live risk — closed business isn't "at risk" — so they report a count but
contribute nothing to `atRiskValue`.

**What this deliberately does not claim to detect.** Two leak types are real but out of reach of
this API: leads that disappear between systems, and leads an ad platform says it delivered that
never reached the CRM. Both need visibility this service does not have — an upstream system's own
delivery log, or an ad platform's own lead count — and inventing a number without that data would
be worse than not reporting one. The response's `outOfScope` field says so explicitly rather than
silently omitting the capability. `silentSources` is the closest honest proxy available from data
already inside the CRM: an active channel that has captured leads before and has now gone quiet is
the visible symptom of exactly that failure mode, even without visibility into its cause.

### Response time intelligence

```http
GET /api/leads/response-times?sourceId=...
Authorization: Bearer <token>
```

Six gaps in the journey, each measured in hours:

| Gap | Measures | Attributed to a salesperson? |
|---|---|---|
| Lead received → assigned | Routing speed | No — a routing decision, not a rep's |
| Assigned → first contact | **Speed to lead** — the classic sales SLA | Yes |
| First contact → reply | How fast the lead answers | No — the lead's behaviour, not the rep's |
| Reply → salesperson response | Conversation turnaround after the lead engages | Yes |
| Meeting → follow-up | Time to the next touch after a meeting | Yes |
| Quote → follow-up | Time to the next touch after pricing goes out | Yes |

Two gaps are deliberately **not** ranked by salesperson: who gets assigned a lead is a routing
decision, and how fast a lead replies is the lead's behaviour — scoring a rep on either would
grade them on someone else's speed. The four that remain are ranked fastest-to-slowest, with a
`minSampleSize` floor (default 3) so a rep with one lucky fast lead cannot be crowned "best
salesperson" off a sample of one.

```jsonc
{
  "headlines": [
    "Average first response: 4h 17m",
    "Best salesperson: Priya Nair — 18m",
    "Worst salesperson: Arjun Rao — 11h 42m",
    "34% of leads contacted after 2 hours are being lost."
  ]
}
```

**The correlation the funnel and the leakage report can't answer: does contacting a lead late
actually cost the deal.** `speedToLossCorrelation` takes every lead that reached a decision — won
or lost, an open lead has not lost yet — and splits it at `contactSpeedThresholdHours` (default 2),
reporting the loss rate on each side plus the full six-bucket curve (`0–1h` … `24h+`) in
`byBucket`, so the report shows the shape of the curve, not just one cut through it.

**Where the numbers come from.** `captured_to_assigned`, `assigned_to_first_contact` and
`first_contact_to_reply` read straight off the milestone columns. The other three ask "what
happened *next*" — `lastFollowUpAt` only tracks the *latest* follow-up ever logged, not the one
that actually came right after a specific meeting or quote — so those three scan the activity
timeline instead, the same trade-off the funnel's response-time averages already make.

### Follow-up failure detection

```http
GET /api/leads/follow-ups
Authorization: Bearer <token>
```

Checks one specific state machine on every open lead:

```
Lead replied → Salesperson replied → No response for 3 days → Follow-up required
```

This is narrower than leakage's `no_followup_after_contact`, and deliberately so. It only fires
once a **real back-and-forth was established** — the lead answered at least once — **and the
salesperson made the last move**. A lead that was called once and never replied is a different,
earlier failure (that's what `no_followup_after_contact` is for). A lead whose own message is the
most recent is excluded too — that means the *rep* owes a reply, which is a response-time problem
(`reply_to_salesperson_response` on `/leads/response-times`), not a forgotten follow-up.

```jsonc
{
  "summary": { "today": 18, "overdue": 11, "critical": 5, "totalDue": 34, "totalAtRiskValue": 4120000 },
  "headlines": ["Today: 18", "Overdue: 11", "Critical: 5"]
}
```

**Three urgency tiers**, driven by two thresholds (`followUpAfterDays`, default 3;
`criticalOverdueDays`, default 4 — a full week of silence in total):

| Tier | Meaning |
|---|---|
| `today` | Just crossed the silence threshold within the last day |
| `overdue` | Past due, short of critical |
| `critical` | `criticalOverdueDays` past the threshold — a full week of silence by default |

`groups` always returns exactly three entries, even when a bucket is empty, so a dashboard can
render three tiles ("Today: 18 / Overdue: 11 / Critical: 5") without conditional logic.

**Where the "last move" comes from.** Same activity-timeline scan the response-time report uses
(the same `listConversationActivities` query, reused rather than duplicated): for each lead, the
most recent conversation-type activity (excluding internal notes and tasks — a private reminder is
not a response to the lead) determines both who moved last and when the silence clock started.

### Other queries worth knowing

```http
GET /api/leads?unassigned=true                    # nobody owns these
GET /api/leads?staleForDays=7&status=OPEN         # untouched for a week — the manager's queue
GET /api/leads?channel=WHATSAPP,INSTAGRAM         # comma-separated filters
GET /api/leads?search=kestrel                     # name, company, email, phone
GET /api/leads?sort=estimatedValue&order=desc
```

An unknown value inside a list filter is a **422, not a silent drop** — quietly ignoring
`status=WON,MAYBE` would return a wider result set than was asked for.

### Lead engine safety rails

- **Tenancy has no cross-tenant mode.** Unlike organizations, the lead engine is always confined to
  `user.organizationId`, even for Super Admin. A merged pipeline across tenants is not a view
  anybody wants — the stages do not line up, and a funnel over two companies' leads is meaningless.
- **A lead nobody can be reached at is rejected** — at least one of email, phone or whatsapp. The
  alternative is a row that sits in the pipeline forever, is counted in every funnel, and never
  converts.
- **Marking a lead lost requires a reason.** It is the one field that turns "we lose 40% at
  quotation" into something a team can act on.
- **`PATCH /leads/:id` cannot move the pipeline.** Stage, status, owner and every milestone are
  absent from the schema; each has a dedicated endpoint that writes a timeline entry.
- **Assignees are tenant-checked.** Assigning to a user id from another tenant returns 422 —
  identical to a user id that does not exist, so it confirms nothing.
- **Sources and stages cannot be deleted while in use** (409), and system ones cannot be deleted at
  all. A source's `key` and `channel` are immutable; a stage's `type` is immutable — flipping one
  from `OPEN` to `WON` would silently reclassify every lead in it as revenue.
- **Deleting a user nulls their leads rather than cascading.** Losing pipeline because a
  salesperson left would be indefensible.
- **Capture is idempotent** on `(sourceId, externalId)`, enforced by a unique index. Postgres treats
  NULLs as distinct, so manually entered leads are unconstrained.

---

## Testing

```bash
npm test                  # 224 unit tests, no database needed

npm run test:db:setup     # one-time: migrate + seed the separate auth_test database
npm run test:integration  # HTTP suite against a real Postgres
```

Integration tests delete rows, so they run against a **separate `auth_test` database** —
`test:db:setup` refuses to run against anything not named `auth_test`. Create it first with
`createdb auth_test` (or `CREATE DATABASE auth_test;`).

The unit suite covers JWT signing/verification (including forged, tampered, expired,
wrong-audience and wrong-type tokens), bcrypt behaviour, opaque token generation and parsing,
Zod schemas, and the serializer's exclusion of `passwordHash`.

It also pins the **journey engine** ([lead-milestones.test.ts](tests/unit/lead-milestones.test.ts)):
that an outbound call is contact and an inbound one is a reply, that a note is neither, that later
milestones backfill earlier ones, that a milestone is never rewritten, that moving a lead backwards
erases nothing, and that the funnel reports 127 → 89 → 54 → 31 → 18 → 7 with the right loss at each
step. Everything the product shows about a funnel is derived from those functions, so a bug there
is a bug in every number on the screen.

Same treatment for the **leakage engine** ([lead-leakage.test.ts](tests/unit/lead-leakage.test.ts)):
every rule tested at its threshold boundary, that a closed lead never trips a live-risk rule, that
duplicate detection excludes closed leads and never flags a lead against itself, and that a silent
source needs prior captures to be silent about. [lead.test.ts](tests/integration/lead.test.ts)
drives the real endpoint end to end for each rule, tenant isolation, and authorization.

And for **response time intelligence**
([response-time.test.ts](tests/unit/response-time.test.ts)): that a negative gap is excluded rather
than reported as fast, that salesperson ranking respects the minimum sample size, and that the
speed-to-loss correlation excludes open leads and sums correctly across every bucket.

And for **follow-up failure detection**
([follow-up.test.ts](tests/unit/follow-up.test.ts)): that a lead only qualifies once the lead has
actually replied and the salesperson moved last, that an unanswered inbound message is excluded
(that's a different problem), and each urgency tier's boundary.

The integration suite drives the real Express app with supertest and asserts the security
properties directly — that the refresh token is absent from the response body, that only its
hash is in the database, that a logged-out token stops working, that `/me` still authorizes
after every refresh token is deleted (proving authorization is stateless), and that an unknown
email is indistinguishable from a wrong password.

`app.ts` exports `createApp()` without starting a listener, which is what makes this possible.

---

## Production notes

- Set `NODE_ENV=production` — this switches cookies to `Secure` and suppresses error detail.
- Set `TRUST_PROXY=true` **only** when a load balancer really is in front.
- Run `npx prisma migrate deploy` on deploy; never `migrate dev`.
- Schedule `deleteExpiredRefreshTokens()` ([token.repository.ts](src/auth/token.repository.ts))
  to keep the table bounded.
- Graceful shutdown on `SIGTERM`/`SIGINT` drains in-flight requests before closing the pool,
  with a 10s backstop.
- `/health/ready` checks Postgres — point your orchestrator's readiness probe at it and its
  liveness probe at `/health`.
