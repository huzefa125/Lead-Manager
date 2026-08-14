import pino from 'pino';
import { env } from './env';

/**
 * Structured logger. Pretty-printed locally, newline-delimited JSON in
 * production so log aggregators can parse it.
 *
 * `redact` is a safety net: even if a request body or user record is logged by
 * accident, secrets never reach the log sink.
 */
export const logger = pino({
  level: env.isTest ? 'silent' : env.LOG_LEVEL,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      '*.password',
      '*.passwordHash',
      '*.refreshToken',
      '*.accessToken',
      'password',
      'passwordHash',
      'refreshToken',
      'accessToken',
    ],
    censor: '[REDACTED]',
  },
  ...(env.isProduction
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' },
        },
      }),
});
