import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError, type ZodSchema } from 'zod';
import { ApiError, type ErrorDetail } from '../utils/api-error';

export interface ValidationSchemas {
  body?: ZodSchema;
  query?: ZodSchema;
  params?: ZodSchema;
}

export function zodIssuesToDetails(error: ZodError): ErrorDetail[] {
  return error.issues.map((issue) => ({
    field: issue.path.join('.') || '(root)',
    message: issue.message,
  }));
}

/**
 * Parses request input and replaces it with the parsed result, so handlers
 * receive coerced, trimmed, defaulted values — and anything not described by
 * the schema is stripped rather than reaching the database.
 *
 * Note: `req.query` and `req.params` are getter-only in Express 5, so their
 * parsed values are exposed on `req.validated` instead of being reassigned.
 */
export function validate(schemas: ValidationSchemas): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      if (schemas.body) {
        req.body = schemas.body.parse(req.body ?? {});
      }
      if (schemas.query) {
        req.validated = { ...req.validated, query: schemas.query.parse(req.query ?? {}) };
      }
      if (schemas.params) {
        req.validated = { ...req.validated, params: schemas.params.parse(req.params ?? {}) };
      }
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        next(ApiError.validation('Validation failed', zodIssuesToDetails(error)));
        return;
      }
      next(error);
    }
  };
}
