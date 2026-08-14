/**
 * Machine-readable error codes returned to clients as `error.code`.
 * Clients should branch on these, never on the human-readable message.
 */
export const ErrorCode = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  TOKEN_INVALID: 'TOKEN_INVALID',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  ACCOUNT_DISABLED: 'ACCOUNT_DISABLED',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

export interface ErrorDetail {
  field: string;
  message: string;
}

/**
 * An error that is safe to show the caller. Anything thrown that is *not* an
 * ApiError is treated as a bug and reported as a generic 500.
 */
export class ApiError extends Error {
  public readonly statusCode: number;
  public readonly code: ErrorCodeValue;
  public readonly details?: ErrorDetail[];
  /** `true` means "expected failure mode", not "server is broken". */
  public readonly isOperational = true;

  constructor(
    statusCode: number,
    code: ErrorCodeValue,
    message: string,
    details?: ErrorDetail[],
  ) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
    if (details) this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }

  static badRequest(message: string, details?: ErrorDetail[]): ApiError {
    return new ApiError(400, ErrorCode.VALIDATION_ERROR, message, details);
  }

  static validation(message = 'Validation failed', details?: ErrorDetail[]): ApiError {
    return new ApiError(422, ErrorCode.VALIDATION_ERROR, message, details);
  }

  static unauthorized(
    message = 'Authentication required',
    code: ErrorCodeValue = ErrorCode.UNAUTHORIZED,
  ): ApiError {
    return new ApiError(401, code, message);
  }

  static invalidCredentials(message = 'Invalid email or password'): ApiError {
    return new ApiError(401, ErrorCode.INVALID_CREDENTIALS, message);
  }

  static forbidden(message = 'You do not have permission to perform this action'): ApiError {
    return new ApiError(403, ErrorCode.FORBIDDEN, message);
  }

  static notFound(message = 'Resource not found'): ApiError {
    return new ApiError(404, ErrorCode.NOT_FOUND, message);
  }

  static conflict(message = 'Resource already exists'): ApiError {
    return new ApiError(409, ErrorCode.CONFLICT, message);
  }

  static internal(message = 'An unexpected error occurred'): ApiError {
    return new ApiError(500, ErrorCode.INTERNAL_ERROR, message);
  }
}
