import { describe, expect, it } from 'vitest';
import { authRouter } from '../../src/auth/auth.routes';
import { openApiDocument } from '../../src/docs/openapi';
import { leadRouter, leadSourceRouter, leadStageRouter } from '../../src/leads';
import { organizationRouter } from '../../src/organizations';
import { permissionRouter, roleRouter, userRouter } from '../../src/rbac';

/**
 * The spec is hand-written, which is what lets it document things types cannot
 * express — but hand-written also means it can silently fall out of step with
 * the routes. These checks are the cheap half of keeping it honest: every route
 * the app serves appears in the spec, and every `$ref` resolves.
 *
 * What they cannot check is whether the prose is still true. That stays a
 * reading job.
 */

interface OpenApiDocument {
  paths: Record<string, Record<string, unknown>>;
  components: { schemas: Record<string, unknown> };
  tags: { name: string }[];
}

const doc = openApiDocument as unknown as OpenApiDocument;

/** Express path (`/leads/:id`) → OpenAPI path (`/leads/{id}`). */
function toOpenApiPath(path: string): string {
  return path.replace(/:(\w+)/g, '{$1}');
}

interface RouteLayer {
  route?: { path: string; methods: Record<string, boolean> };
}

/**
 * Mount points, restated here rather than recovered from Express internals.
 *
 * Express 5 does not expose a router's mount path, and reverse-engineering it
 * from `layer.regexp` breaks whenever path-to-regexp changes. Repeating the
 * prefixes is a small duplication of `src/routes/index.ts`; in exchange the
 * check keeps working across Express upgrades — and a router mounted at the
 * wrong prefix still shows up, as a path the spec does not document.
 */
const MOUNTS: [string, { stack: RouteLayer[] }][] = [
  ['/auth', authRouter as unknown as { stack: RouteLayer[] }],
  ['/organizations', organizationRouter as unknown as { stack: RouteLayer[] }],
  ['/roles', roleRouter as unknown as { stack: RouteLayer[] }],
  ['/permissions', permissionRouter as unknown as { stack: RouteLayer[] }],
  ['/users', userRouter as unknown as { stack: RouteLayer[] }],
  ['/leads', leadRouter as unknown as { stack: RouteLayer[] }],
  ['/lead-sources', leadSourceRouter as unknown as { stack: RouteLayer[] }],
  ['/lead-stages', leadStageRouter as unknown as { stack: RouteLayer[] }],
];

/** Collects `METHOD /path` for every route a router serves. */
function collectRoutes(prefix: string, router: { stack: RouteLayer[] }): string[] {
  const found: string[] = [];

  for (const layer of router.stack) {
    if (!layer.route) continue;
    const path = toOpenApiPath(`${prefix}${layer.route.path}`.replace(/\/$/, '') || prefix);
    for (const method of Object.keys(layer.route.methods)) {
      found.push(`${method.toUpperCase()} ${path}`);
    }
  }

  return found;
}

describe('OpenAPI document', () => {
  it('serializes — Swagger UI serves it as JSON', () => {
    expect(() => JSON.stringify(doc)).not.toThrow();
  });

  it('resolves every schema reference', () => {
    const json = JSON.stringify(doc);
    const referenced = new Set(
      [...json.matchAll(/#\/components\/schemas\/(\w+)/g)].map((match) => match[1] as string),
    );
    const defined = new Set(Object.keys(doc.components.schemas));

    expect([...referenced].filter((name) => !defined.has(name))).toEqual([]);
  });

  it('gives every operation a tag that is declared', () => {
    const declared = new Set(doc.tags.map((tag) => tag.name));
    const used = new Set<string>();

    for (const operations of Object.values(doc.paths)) {
      for (const operation of Object.values(operations)) {
        for (const tag of (operation as { tags?: string[] }).tags ?? []) used.add(tag);
      }
    }

    expect([...used].filter((tag) => !declared.has(tag))).toEqual([]);
  });

  it('documents the lead engine', () => {
    const leadPaths = Object.keys(doc.paths).filter((path) => path.startsWith('/lead'));

    expect(leadPaths).toEqual(
      expect.arrayContaining([
        '/leads',
        '/leads/capture',
        '/leads/funnel',
        '/leads/{id}',
        '/leads/{id}/assignment',
        '/leads/{id}/stage',
        '/leads/{id}/timeline',
        '/leads/{id}/activities',
        '/lead-sources',
        '/lead-sources/{id}',
        '/lead-stages',
        '/lead-stages/{id}',
      ]),
    );
  });

  it('has an entry for every route the API actually serves', () => {
    const routes = MOUNTS.flatMap(([prefix, router]) => collectRoutes(prefix, router));

    // Guards the guard: if route collection ever silently returns nothing, an
    // empty list would pass this test while checking absolutely nothing.
    expect(routes.length).toBeGreaterThan(30);

    const undocumented = routes.filter((route) => {
      const [method, path] = route.split(' ') as [string, string];
      return !doc.paths[path]?.[method.toLowerCase()];
    });

    expect(undocumented).toEqual([]);
  });
});
