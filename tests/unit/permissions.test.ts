import { describe, expect, it } from 'vitest';
import {
  hasAllPermissions,
  hasAnyPermission,
  hasPermission,
  matchesPermission,
  missingPermissions,
  parseAction,
} from '../../src/utils/permissions';

/**
 * These cases are the entire authorization decision. If this file is correct,
 * `authorize()` is correct.
 */
describe('permission matching', () => {
  it('matches an exact action', () => {
    expect(matchesPermission('employee.create', 'employee.create')).toBe(true);
  });

  it('rejects a different operation on the same resource', () => {
    expect(matchesPermission('employee.view', 'employee.create')).toBe(false);
  });

  it('rejects the same operation on a different resource', () => {
    expect(matchesPermission('department.create', 'employee.create')).toBe(false);
  });

  describe('global wildcard', () => {
    it('grants any current permission', () => {
      expect(matchesPermission('*', 'employee.create')).toBe(true);
      expect(matchesPermission('*', 'role.delete')).toBe(true);
    });

    it('grants permissions for modules that do not exist yet', () => {
      // The reason Super Admin never needs reseeding.
      expect(matchesPermission('*', 'invoice.approve')).toBe(true);
      expect(matchesPermission('*', 'anything.at.all')).toBe(true);
    });
  });

  describe('resource wildcard', () => {
    it('grants every operation on its own resource', () => {
      expect(matchesPermission('employee.*', 'employee.view')).toBe(true);
      expect(matchesPermission('employee.*', 'employee.delete')).toBe(true);
      expect(matchesPermission('employee.*', 'employee.archive')).toBe(true);
    });

    it('does not leak to other resources', () => {
      expect(matchesPermission('employee.*', 'department.view')).toBe(false);
      expect(matchesPermission('employee.*', 'user.delete')).toBe(false);
    });

    it('is not satisfied by a prefix collision', () => {
      // "employee_record" must not be covered by "employee.*".
      expect(matchesPermission('employee.*', 'employee_record.view')).toBe(false);
    });
  });

  it('never treats a required wildcard as satisfied by a narrow grant', () => {
    // Holding one permission must not imply holding the whole resource.
    expect(matchesPermission('employee.view', 'employee.*')).toBe(false);
    expect(matchesPermission('employee.view', '*')).toBe(false);
  });
});

describe('hasPermission', () => {
  const granted = ['employee.view', 'department.*'];

  it('is true when any grant matches', () => {
    expect(hasPermission(granted, 'employee.view')).toBe(true);
    expect(hasPermission(granted, 'department.create')).toBe(true);
  });

  it('is false when none match', () => {
    expect(hasPermission(granted, 'employee.delete')).toBe(false);
    expect(hasPermission([], 'employee.view')).toBe(false);
  });
});

describe('any / all semantics', () => {
  const granted = ['employee.view'];

  it('hasAnyPermission needs only one', () => {
    expect(hasAnyPermission(granted, ['employee.view', 'employee.delete'])).toBe(true);
    expect(hasAnyPermission(granted, ['role.view', 'employee.delete'])).toBe(false);
  });

  it('hasAllPermissions needs every one', () => {
    expect(hasAllPermissions(granted, ['employee.view'])).toBe(true);
    expect(hasAllPermissions(granted, ['employee.view', 'employee.delete'])).toBe(false);
  });

  it('reports precisely which permissions are missing', () => {
    expect(missingPermissions(granted, ['employee.view', 'employee.delete', 'role.view'])).toEqual([
      'employee.delete',
      'role.view',
    ]);
  });
});

describe('parseAction', () => {
  it('splits resource and operation', () => {
    expect(parseAction('employee.create')).toEqual({
      resource: 'employee',
      operation: 'create',
    });
  });

  it('handles the global wildcard', () => {
    expect(parseAction('*')).toEqual({ resource: '*', operation: '*' });
  });

  it('handles a resource wildcard', () => {
    expect(parseAction('employee.*')).toEqual({ resource: 'employee', operation: '*' });
  });

  it('rejects malformed actions', () => {
    expect(parseAction('employee')).toBeNull();
    expect(parseAction('.create')).toBeNull();
    expect(parseAction('employee.')).toBeNull();
    expect(parseAction('')).toBeNull();
  });
});
