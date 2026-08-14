import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { env } from './config/env';
import { logger } from './config/logger';
import { prisma } from './config/prisma';
import { docsRouter } from './docs';
import { errorHandler } from './middleware/error-handler';
import { notFoundHandler } from './middleware/not-found';
import { globalRateLimiter } from './middleware/rate-limit';
import { requestId } from './middleware/request-id';
import { apiRouter } from './routes';
import { sendSuccess } from './utils/api-response';
import { asyncHandler } from './utils/async-handler';

/**
 * Builds the Express app without starting a listener, so tests can drive it
 * with supertest and the server file stays responsible only for lifecycle.
 *
 * Middleware order is load-bearing: correlation id → security headers → CORS →
 * body parsing → rate limiting → routes → 404 → error handler.
 */
export function createApp(): Express {
  const app = express();

  // Behind a load balancer this makes req.ip the real client address, which
  // the rate limiter and refresh-token audit trail both depend on. Leave it
  // off unless a proxy really is in front — otherwise clients can spoof
  // X-Forwarded-For and evade rate limiting.
  app.set('trust proxy', env.TRUST_PROXY ? 1 : false);
  app.disable('x-powered-by');

  app.use(requestId);

  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as { requestId?: string }).requestId ?? '',
      autoLogging: { ignore: (req) => req.url === '/health' || req.url === '/health/ready' },
    }),
  );

  app.use(helmet());

  app.use(
    cors({
      origin: env.corsOrigins.length > 0 ? env.corsOrigins : false,
      credentials: true, // required for the refresh cookie
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
      exposedHeaders: ['X-Request-Id'],
    }),
  );

  // Bounded body size — an auth payload is never large, and an unbounded
  // parser is free memory pressure for an attacker.
  app.use(express.json({ limit: '10kb' }));
  app.use(express.urlencoded({ extended: false, limit: '10kb' }));
  app.use(cookieParser());

  // --- Health checks (before the rate limiter, so probes are never throttled) ---

  app.get('/health', (_req, res) => {
    sendSuccess(res, { status: 'ok', uptime: process.uptime() });
  });

  /** Readiness verifies the dependency that actually matters: the database. */
  app.get(
    '/health/ready',
    asyncHandler(async (_req, res) => {
      await prisma.$queryRaw`SELECT 1`;
      sendSuccess(res, { status: 'ready', database: 'connected' });
    }),
  );

  // Docs sit ahead of the rate limiter — reading the reference should never
  // consume a caller's request budget.
  if (env.ENABLE_API_DOCS) {
    app.use('/api', docsRouter);
  }

  app.use(globalRateLimiter);

  app.use('/api', apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
