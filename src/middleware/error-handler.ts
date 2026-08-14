import { Prisma } from '@prisma/client';
import type { ErrorRequestHandler, NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { ZodError } from 'zod';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { ApiError, ErrorCode, type ErrorCodeValue, type ErrorDetail } from '../utils/api-error';
import { sendError } from '../utils/api-response';
import { zodIssuesToDetails } from './validate';

interface NormalizedError {
  statusCode: number;
  code: ErrorCodeValue;
  message: string;
  details?: ErrorDetail[];
  /** Expected failures are logged at warn; everything else is a bug worth an error log. */
  isOperational: boolean;
}

/**
 * Turns anything thrown anywhere in the app into a safe, predictable response.
 *
 * The rule that matters: unrecognised errors never have their message returned
 * to the client. A driver error string can carry a connection URL, a query, or
 * a row of data, so unknown failures collapse to a flat 500.
 */
function normalize(error: unknown): NormalizedError {
  if (error instanceof ApiError) {
    return {
      statusCode: error.statusCode,
      code: error.code,
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
      isOperational: true,
    };
  }

  // Zod errors from schemas parsed outside the validate() middleware.
  if (error instanceof ZodError) {
    return {
      statusCode: 422,
      code: ErrorCode.VALIDATION_ERROR,
      message: 'Validation failed',
      details: zodIssuesToDetails(error),
      isOperational: true,
    };
  }

  if (error instanceof jwt.JsonWebTokenError) {
    return {
      statusCode: 401,
      code:
        error instanceof jwt.TokenExpiredError
          ? ErrorCode.TOKEN_EXPIRED
          : ErrorCode.TOKEN_INVALID,
      message:
        error instanceof jwt.TokenExpiredError ? 'Token has expired' : 'Invalid token',
      isOperational: true,
    };
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return normalizePrismaError(error);
  }

  if (error instanceof Prisma.PrismaClientValidationError) {
    // A malformed query is our bug, not the caller's.
    return {
      statusCode: 500,
      code: ErrorCode.INTERNAL_ERROR,
      message: 'An unexpected error occurred',
      isOperational: false,
    };
  }

  // Body parser rejections arrive as plain errors carrying a status.
  if (isBodyParserError(error)) {
    return {
      statusCode: 400,
      code: ErrorCode.VALIDATION_ERROR,
      message: 'Malformed request body',
      isOperational: true,
    };
  }

  return {
    statusCode: 500,
    code: ErrorCode.INTERNAL_ERROR,
    message: 'An unexpected error occurred',
    isOperational: false,
  };
}

function normalizePrismaError(
  error: Prisma.PrismaClientKnownRequestError,
): NormalizedError {
  switch (error.code) {
    // Unique constraint violation — the race the pre-check in user.service
    // cannot close on its own.
    case 'P2002': {
      const target = error.meta?.['target'];
      const fields = Array.isArray(target) ? target.map(String) : [];
      const isEmail = fields.some((field) => field.toLowerCase().includes('email'));
      return {
        statusCode: 409,
        code: ErrorCode.CONFLICT,
        message: isEmail
          ? 'An account with this email already exists'
          : 'A record with these values already exists',
        isOperational: true,
      };
    }
    // Foreign key constraint failed.
    case 'P2003':
      return {
        statusCode: 409,
        code: ErrorCode.CONFLICT,
        message: 'Operation violates a data relationship constraint',
        isOperational: true,
      };
    // Record required by the operation was not found.
    case 'P2025':
      return {
        statusCode: 404,
        code: ErrorCode.NOT_FOUND,
        message: 'Resource not found',
        isOperational: true,
      };
    default:
      return {
        statusCode: 500,
        code: ErrorCode.INTERNAL_ERROR,
        message: 'An unexpected error occurred',
        isOperational: false,
      };
  }
}

function isBodyParserError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'type' in error &&
    typeof (error as { type: unknown }).type === 'string' &&
    ['entity.parse.failed', 'entity.too.large', 'encoding.unsupported'].includes(
      (error as { type: string }).type,
    )
  );
}

export const errorHandler: ErrorRequestHandler = (
  error: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  // Headers already flushed — hand back to Express to close the connection.
  if (res.headersSent) {
    next(error);
    return;
  }

  const normalized = normalize(error);

  const logContext = {
    requestId: req.requestId,
    method: req.method,
    path: req.originalUrl,
    statusCode: normalized.statusCode,
    code: normalized.code,
    userId: req.user?.id,
    err: error,
  };

  if (normalized.isOperational) {
    logger.warn(logContext, normalized.message);
  } else {
    // The real error is logged in full here — this is the only place the
    // underlying detail exists, since the client only gets a generic message.
    logger.error(logContext, 'Unhandled error while processing request');
  }

  // Stack traces are a development affordance only; never in production output.
  if (!env.isProduction && !normalized.isOperational && error instanceof Error) {
    res.setHeader('x-error-name', error.name);
  }

  sendError(res, normalized.statusCode, normalized.code, normalized.message, normalized.details);
};
