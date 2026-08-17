# Lead Manager — web

The frontend for the lead manager API. React 19 + TypeScript, TanStack Router and
Query, shadcn/ui on Tailwind v4.

Self-contained: it has its own `package.json` and touches nothing in the API
project. Run the two side by side.

```bash
cd web
npm install
npm run dev          # http://localhost:3000
```

`npm run dev` proxies `/api` to `http://localhost:4000`. Point it elsewhere with
`VITE_API_PROXY_TARGET` — see `.env.example`.

| Script | |
|---|---|
| `npm run dev` | Vite dev server with the API proxy |
| `npm run build` | typecheck, then a production bundle in `dist/` |
| `npm run typecheck` | types only |
| `npm run lint` | oxlint |

## How it is put together

```
src/
  routes/          file-based routes; the tree in routeTree.gen.ts is generated
  features/        one folder per API area — queries live beside the UI using them
  components/      app-wide pieces, with shadcn primitives under components/ui
  lib/             api client, permission matching, formatting
  types/api.ts     the API's shapes, mirrored from the server's serializers
```

Four decisions are worth knowing before changing anything.

**The access token never leaves memory.** It lives in a module variable in
`lib/api.ts`, never in `localStorage`. The refresh token is an httpOnly cookie the
JavaScript cannot read. That is what the server's split delivery is designed for:
an XSS payload can steal at most one access-token lifetime instead of a 7-day
session. A 401 triggers exactly one refresh — shared by every request that raced
into the same expiry — and then replays the originals, so callers never see it.

**The dev server proxies the API rather than calling it cross-origin.** Same
origin means the refresh cookie is sent with no `SameSite=None` and no CORS
dance. Deploy the same way — a reverse proxy serving both under one origin — or
set `VITE_API_BASE_URL` and adjust the server's `CORS_ORIGINS` and cookie flags
to match.

**Permission checks here are cosmetic.** `lib/permissions.ts` mirrors the server's
matcher, wildcards included, and decides whether a button renders. It never
decides whether an action is allowed — every route is authorized again server
side, so editing this in devtools buys a form and a 403.

**Server state belongs to TanStack Query; filters belong to the URL.** A filtered
pipeline is the thing people paste to each other, so the leads screen keeps its
filters in validated search params. Lead mutations invalidate the whole `leads`
tree rather than patching the cache: logging one activity can move a milestone,
change the stage and shift the funnel, and reproducing the server's journey rules
client side to patch precisely would be a second implementation to keep correct.

## Design

The theme comes from the shadcn preset `b6sUj34d9` — a warm stone neutral,
Geist Variable, generous radii. It is applied through `src/index.css`; changing
the palette means changing the tokens there, not the components.

The preset's `--chart-*` ramp is monochrome, which suits ordered magnitude (the
funnel is one series — bar *length* is the encoding, so every bar wears one hue
and there is no legend to read) but says nothing about state. `index.css` adds
four reserved status tokens — `status-good`, `status-warning`, `status-serious`,
`status-critical` — used only for state, and always beside an icon and a word so
hue never carries meaning on its own.

Money the API reports without a currency — funnel totals, at-risk values, stage
occupancy — is rendered without a symbol. Those figures are summed across
whatever currencies a tenant's leads carry, so inventing a symbol would be a
guess, and a wrong one for anybody not billing in it. Per-lead values, which do
carry a currency, are formatted with it.
