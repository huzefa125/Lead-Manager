import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Forwards rejected promises from async handlers to Express' error middleware.
 *
 * Express 5 does this natively, but wrapping keeps the behaviour explicit and
 * makes the controllers portable if the app is ever moved back to Express 4.
 */
export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}
