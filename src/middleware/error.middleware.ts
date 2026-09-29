/**
 * Centralized error middleware: maps domain errors to JSON responses.
 * Wraps the downstream chain so every route gets uniform error handling.
 */

import { AppError, RateLimitedError } from '../core/errors/app-error.ts';
import { errorResponse, internalError } from '../core/http/response.ts';
import { logger } from '../core/logger.ts';
import type { Middleware, RequestContext } from '../core/http/router.ts';

export const errorMiddleware: Middleware = async (ctx: RequestContext, next) => {
  try {
    return await next();
  } catch (error) {
    if (error instanceof RateLimitedError) {
      const response = errorResponse(error.statusCode, error.code, error.message);
      response.headers.set('Retry-After', String(error.retryAfterSeconds));
      return response;
    }
    if (error instanceof AppError) {
      return errorResponse(error.statusCode, error.code, error.message, error.details);
    }
    logger.error('Unhandled error', {
      error: (error as Error).message,
      path: new URL(ctx.request.url).pathname,
    });
    return internalError();
  }
};
