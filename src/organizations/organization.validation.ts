import { z } from 'zod';

export const organizationNameSchema = z
  .string()
  .trim()
  .min(2, 'Organization name must be at least 2 characters')
  .max(100, 'Organization name must not exceed 100 characters');

export const createOrganizationSchema = z.object({
  name: organizationNameSchema,
  description: z.string().trim().max(500).optional(),
  /**
   * Optional. Derived from the name when omitted; a collision is resolved by
   * appending a counter.
   */
  slug: z
    .string()
    .trim()
    .min(2)
    .max(50)
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Slug must be lowercase words separated by hyphens')
    .optional(),
});

export const updateOrganizationSchema = z
  .object({
    name: organizationNameSchema.optional(),
    description: z.string().trim().max(500).nullable().optional(),
    /**
     * Deactivating an organization blocks sign-in for all of its users, so it
     * is restricted to cross-tenant administrators in the service layer.
     */
    isActive: z.boolean().optional(),
  })
  // `slug` is absent on purpose: it may appear in URLs and integrations, so
  // changing it would silently break external references.
  .refine((value) => Object.keys(value).length > 0, 'Provide at least one field to update');

export const listOrganizationsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().trim().min(1).max(100).optional(),
});

export const organizationIdParamSchema = z.object({
  id: z.string().uuid('Must be a valid UUID'),
});

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;
export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;
export type ListOrganizationsQuery = z.infer<typeof listOrganizationsQuerySchema>;
