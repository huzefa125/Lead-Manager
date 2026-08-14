# Auth Service

Authentication foundation built on **Node.js + Express 5 + TypeScript (strict) + PostgreSQL + Prisma**.

Registration, login, JWT access tokens, database-backed refresh tokens, a protected `/me`
endpoint, and logout. RBAC is deliberately **not** implemented — the schema and token payload
are shaped so it can be added without a breaking change.

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
| `POST` | `/api/auth/register` | — | — | Create account, open session |
| `POST` | `/api/auth/login` | — | — | Authenticate, open session |
| `POST` | `/api/auth/refresh` | refresh cookie | — | New access token + rotated refresh token |
| `POST` | `/api/auth/logout` | refresh cookie | — | Delete this session |
| `POST` | `/api/auth/logout-all` | Bearer | — | Delete all sessions |
| `GET` | `/api/auth/me` | Bearer | — | Current user, roles and permissions |
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
├── rbac/            roles, permissions, user-role assignment
│                    permission.constants.ts — the catalogue (edit to add a module)
├── users/           repository, service, serializer, types
├── middleware/      authenticate, authorize, validate, error-handler,
│                    rate-limit, request-id, not-found
├── utils/           ApiError, response envelope, jwt, password, crypto, duration
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
| `super_admin` | `*` |
| `admin` | `user.*`, `employee.*`, `department.*`, `role.view`, `role.assign`, `permission.view` |
| `manager` | `user.view`, `employee.view/create/update`, `department.view` |
| `user` | `employee.view`, `department.view` — assigned automatically at registration |

| Seeded login | Password |
|---|---|
| `superadmin@example.com` | `SuperAdmin123!` |
| `admin@example.com` | `Admin123!` |
| `manager@example.com` | `Manager123!` |
| `user@example.com` | `User1234!` |

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

## Testing

```bash
npm test                  # 62 unit tests, no database needed

npm run test:db:setup     # one-time: migrate + seed the separate auth_test database
npm run test:integration  # 76 HTTP tests against a real Postgres
```

Integration tests delete rows, so they run against a **separate `auth_test` database** —
`test:db:setup` refuses to run against anything not named `auth_test`. Create it first with
`createdb auth_test` (or `CREATE DATABASE auth_test;`).

The unit suite covers JWT signing/verification (including forged, tampered, expired,
wrong-audience and wrong-type tokens), bcrypt behaviour, opaque token generation and parsing,
Zod schemas, and the serializer's exclusion of `passwordHash`.

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
