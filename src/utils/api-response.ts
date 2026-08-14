import type { Response } from 'express';
import type { ErrorCodeValue, ErrorDetail } from './api-error';

/**
 * Every response from this API — success or failure — has this envelope.
 * `success` is the single flag a client needs to branch on.
 */
export interface ResponseMeta {
  requestId: string;
  timestamp: string;
}

export interface SuccessResponse<T> {
  success: true;
  data: T;
  meta: ResponseMeta;
}

export interface ErrorResponse {
  success: false;
  error: {
    code: ErrorCodeValue;
    message: string;
    details?: ErrorDetail[];
  };
  meta: ResponseMeta;
}

export type ApiResponse<T> = SuccessResponse<T> | ErrorResponse;

function buildMeta(res: Response): ResponseMeta {
  return {
    requestId: res.locals.requestId ?? 'unknown',
    timestamp: new Date().toISOString(),
  };
}

export function sendSuccess<T>(res: Response, data: T, statusCode = 200): Response {
  const body: SuccessResponse<T> = { success: true, data, meta: buildMeta(res) };
  return res.status(statusCode).json(body);
}

export function sendError(
  res: Response,
  statusCode: number,
  code: ErrorCodeValue,
  message: string,
  details?: ErrorDetail[],
): Response {
  const body: ErrorResponse = {
    success: false,
    error: { code, message, ...(details && details.length > 0 ? { details } : {}) },
    meta: buildMeta(res),
  };
  return res.status(statusCode).json(body);
}
