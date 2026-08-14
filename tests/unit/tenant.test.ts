import { describe, expect, it } from 'vitest';
import {
  assertSameOrganization,
  canAccessAllOrganizations,
  organizationScope,
  slugify,
} from '../../src/utils/tenant';
import { ApiError } from '../../src/utils/api-error';
import type { AuthenticatedUser } from '../../src/users/user.types';

const ACME = 'aaaaaaaa-0000-4000-8000-000000000001';
const GLOBEX = 'bbbbbbbb-0000-4000-8000-000000000002';

function user(permissions: string[], organizationId = ACME): AuthenticatedUser {
  return {
    id: 'user-1',
    email: 'user@example.com',
    organizationId,
    roles: ['admin'],
    permissions,
    tokenId: 'jti-1',
  };
}

describe('tenant confinement', () => {
  it('confines an ordinary admin to their own organization', () => {
    const tenantAdmin = user(['user.*', 'organization.view']);

    expect(canAccessAllOrganizations(tenantAdmin)).toBe(false);
    expect(organizationScope(tenantAdmin)).toEqual({ organizationId: ACME });
  });

  it('lifts confinement for organization.manage_all', () => {
    const platformAdmin = user(['organization.manage_all']);

    expect(canAccessAllOrganizations(platformAdmin)).toBe(true);
    // An empty scope widens the query to every organization — deliberate.
    expect(organizationScope(platformAdmin)).toEqual({});
  });

  it('lifts confinement for the global wildcard', () => {
    // Super Admin holds "*", so it satisfies manage_all without a special case.
    expect(canAccessAllOrganizations(user(['*']))).toBe(true);
  });

  it('lifts confinement for the organization resource wildcard', () => {
    expect(canAccessAllOrganizations(user(['organization.*']))).toBe(true);
  });

  it('is not lifted by other organization permissions', () => {
    // Being able to edit your own organization is not the same as reaching
    // into everyone else's.
    expect(canAccessAllOrganizations(user(['organization.view']))).toBe(false);
    expect(canAccessAllOrganizations(user(['organization.update']))).toBe(false);
    expect(canAccessAllOrganizations(user(['organization.delete']))).toBe(false);
  });
});

describe('assertSameOrganization', () => {
  it('permits access within the caller\'s own organization', () => {
    expect(() => assertSameOrganization(user(['user.view']), ACME)).not.toThrow();
  });

  it('reports another tenant\'s resource as 404, not 403', () => {
    // A 403 would confirm the record exists, which is itself a disclosure.
    try {
      assertSameOrganization(user(['user.view']), GLOBEX, 'User');
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).statusCode).toBe(404);
      expect((error as ApiError).message).toBe('User not found');
    }
  });

  it('permits a cross-tenant administrator anywhere', () => {
    expect(() => assertSameOrganization(user(['*']), GLOBEX)).not.toThrow();
  });
});

describe('slugify', () => {
  it('builds a URL-safe slug', () => {
    expect(slugify('Acme Corporation')).toBe('acme-corporation');
    expect(slugify('  Spaced   Out  ')).toBe('spaced-out');
  });

  it('strips punctuation and collapses separators', () => {
    expect(slugify('Foo & Bar, Inc.')).toBe('foo-bar-inc');
  });

  it('strips diacritics so lookalike names do not diverge', () => {
    expect(slugify('Café Ltd')).toBe('cafe-ltd');
  });

  it('never returns an empty slug', () => {
    // Unique index aside, an empty slug would collapse across organizations.
    expect(slugify('!!!')).toBe('org');
    expect(slugify('')).toBe('org');
  });

  it('bounds the length and leaves no trailing hyphen', () => {
    const slug = slugify('a'.repeat(80));
    expect(slug.length).toBeLessThanOrEqual(50);
    expect(slug.endsWith('-')).toBe(false);
  });
});
