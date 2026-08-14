import type { Request, Response, NextFunction } from 'express';
import { ApiError } from '../utils/api-error';

/** Terminal middleware: any route that fell through becomes a normal 404 error. */
export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(ApiError.notFound(`Route ${req.method} ${req.originalUrl} not found`));
}
