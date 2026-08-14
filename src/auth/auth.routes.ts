import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { authRateLimiter } from '../middleware/rate-limit';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../utils/async-handler';
import * as authController from './auth.controller';
import { loginSchema, logoutSchema, refreshSchema, registerSchema } from './auth.validation';

export const authRouter = Router();

/**
 * Public, credential-accepting endpoints get the strict rate limiter.
 * `/refresh` is included: a stolen refresh token should not be brute-forceable.
 */
authRouter.post(
  '/register',
  authRateLimiter,
  validate({ body: registerSchema }),
  asyncHandler(authController.register),
);

authRouter.post(
  '/login',
  authRateLimiter,
  validate({ body: loginSchema }),
  asyncHandler(authController.login),
);

authRouter.post(
  '/refresh',
  authRateLimiter,
  validate({ body: refreshSchema }),
  asyncHandler(authController.refresh),
);

/** Logout takes a refresh token, not an access token, so it works after expiry. */
authRouter.post(
  '/logout',
  validate({ body: logoutSchema }),
  asyncHandler(authController.logout),
);

// --- Protected ---------------------------------------------------------------
// `authenticate` is synchronous: it verifies the JWT with the secret key in
// memory and performs no database access.

authRouter.get('/me', authenticate, asyncHandler(authController.me));

authRouter.post('/logout-all', authenticate, asyncHandler(authController.logoutAll));
