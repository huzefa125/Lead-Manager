import rateLimit, { type Options } from 'express-rate-limit';
import type { Request, Response } from 'express';
import { env } from '../config/env';
import { ErrorCode } from '../utils/api-error';
import { sendError } from '../utils/api-response';

/**
 * Rate-limit rejections go through the same response envelope as every other
 * error, so clients never have to special-case a 429 body.
 */
const handler = (_req: Request, res: Response): void => {
  sendError(
    res,
    429,
    ErrorCode.RATE_LIMITED,
    'Too many requests — please try again later',
  );
};

const shared: Partial<Options> = {
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler,
  // Limiting is a defence, not a test fixture; disabling it in tests keeps
  // suites from failing on the 11th request.
  skip: () => env.isTest,
};

/** Baseline limit applied to the whole API. */
export const globalRateLimiter = rateLimit({
  ...shared,
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.RATE_LIMIT_MAX,
});

/**
 * Tighter limit for credential-accepting endpoints, which are what a password
 * sprayer actually targets.
 */
export const authRateLimiter = rateLimit({
  ...shared,
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.AUTH_RATE_LIMIT_MAX,
  // Successful logins should not count toward the budget of a legitimate user
  // sharing an office NAT with someone being attacked.
  skipSuccessfulRequests: true,
});
