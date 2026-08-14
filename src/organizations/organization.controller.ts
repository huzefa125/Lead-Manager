import type { Request, Response } from 'express';
import { ApiError } from '../utils/api-error';
import { sendSuccess } from '../utils/api-response';
import type { AuthenticatedUser } from '../users/user.types';
import * as organizationService from './organization.service';
import {
  toPublicOrganization,
  toPublicOrganizations,
} from './organization.serializer';
import type {
  CreateOrganizationInput,
  ListOrganizationsQuery,
  UpdateOrganizationInput,
} from './organization.validation';

function currentUser(req: Request): AuthenticatedUser {
  if (!req.user) throw ApiError.unauthorized();
  return req.user;
}

function params<T>(req: Request): T {
  return req.validated?.params as T;
}

/**
 * GET /api/organizations
 * Confined to the caller's own organization unless they hold
 * `organization.manage_all`.
 */
export async function listOrganizations(req: Request, res: Response): Promise<void> {
  const result = await organizationService.listOrganizations(
    currentUser(req),
    req.validated?.query as ListOrganizationsQuery,
  );

  sendSuccess(res, {
    organizations: toPublicOrganizations(result.organizations),
    pagination: {
      total: result.total,
      page: result.page,
      limit: result.limit,
      totalPages: result.totalPages,
    },
  });
}

/** GET /api/organizations/:id */
export async function getOrganization(req: Request, res: Response): Promise<void> {
  const organization = await organizationService.getOrganizationById(
    currentUser(req),
    params<{ id: string }>(req).id,
  );
  sendSuccess(res, { organization: toPublicOrganization(organization) });
}

/** POST /api/organizations */
export async function createOrganization(req: Request, res: Response): Promise<void> {
  const organization = await organizationService.createOrganization(
    req.body as CreateOrganizationInput,
  );
  sendSuccess(res, { organization: toPublicOrganization(organization) }, 201);
}

/** PATCH /api/organizations/:id */
export async function updateOrganization(req: Request, res: Response): Promise<void> {
  const organization = await organizationService.updateOrganization(
    currentUser(req),
    params<{ id: string }>(req).id,
    req.body as UpdateOrganizationInput,
  );
  sendSuccess(res, { organization: toPublicOrganization(organization) });
}

/** DELETE /api/organizations/:id */
export async function deleteOrganization(req: Request, res: Response): Promise<void> {
  await organizationService.deleteOrganization(
    currentUser(req),
    params<{ id: string }>(req).id,
  );
  sendSuccess(res, { message: 'Organization deleted' });
}

/** GET /api/organizations/current — the caller's own tenant. */
export async function getCurrentOrganization(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const organization = await organizationService.getOrganizationById(user, user.organizationId);
  sendSuccess(res, { organization: toPublicOrganization(organization) });
}
