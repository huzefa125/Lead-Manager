import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

const HEADER = 'x-request-id';
/** Bounded and charset-restricted so a hostile header cannot poison logs. */
const SAFE_ID = /^[A-Za-z0-9_.:-]{1,128}$/;

/**
 * Assigns every request a correlation id, reusing an upstream one when the
 * proxy already set a sane value. Echoed back in the header and in the `meta`
 * block of every response body.
 */
export function requestId(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.get(HEADER);
  const id = incoming && SAFE_ID.test(incoming) ? incoming : crypto.randomUUID();

  req.requestId = id;
  res.locals.requestId = id;
  res.setHeader(HEADER, id);

  next();
}
