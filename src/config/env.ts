import 'dotenv/config';
import { z } from 'zod';
import { parseDuration } from '../utils/duration';

/**
 * Every configuration value the app needs, validated once at boot.
 * A missing or malformed variable crashes the process immediately rather than
 * surfacing as a confusing runtime failure later.
 */
const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),

    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
    JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
    JWT_ISSUER: z.string().min(1).default('auth-service'),
    JWT_AUDIENCE: z.string().min(1).default('auth-service-clients'),
    ACCESS_TOKEN_TTL: z
      .string()
      .min(1)
      .default('15m')
      .refine((value) => parseDuration(value) !== null, 'Must be a duration like 15m, 1h, 30s'),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().max(365).default(7),

    BCRYPT_SALT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),

    CORS_ORIGINS: z.string().default('http://localhost:3000'),
    TRUST_PROXY: z
      .string()
      .default('false')
      .transform((value) => value === 'true' || value === '1'),
    COOKIE_DOMAIN: z.string().optional(),
    REFRESH_COOKIE_NAME: z.string().min(1).default('refresh_token'),

    /**
     * Swagger UI at /api/docs. Defaults on for developer convenience; consider
     * disabling in production, where the spec is a free map of every endpoint
     * and its validation rules.
     */
    ENABLE_API_DOCS: z
      .string()
      .default('true')
      .transform((value) => value === 'true' || value === '1'),

    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
    AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  })
  .superRefine((value, ctx) => {
    if (value.JWT_ACCESS_SECRET === value.JWT_REFRESH_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JWT_REFRESH_SECRET'],
        message: 'JWT_REFRESH_SECRET must differ from JWT_ACCESS_SECRET',
      });
    }
  });

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
  // Logger depends on env, so this one case has to use console.
  // eslint-disable-next-line no-console
  console.error(`Invalid environment configuration:\n${details}\n`);
  process.exit(1);
}

const raw = parsed.data;

export const env = {
  ...raw,
  corsOrigins: raw.CORS_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  /** Access token lifetime in seconds, for clients that want to schedule refresh. */
  accessTokenTtlSeconds: parseDuration(raw.ACCESS_TOKEN_TTL) ?? 900,
  isProduction: raw.NODE_ENV === 'production',
  isTest: raw.NODE_ENV === 'test',
  isDevelopment: raw.NODE_ENV === 'development',
} as const;

export type Env = typeof env;
