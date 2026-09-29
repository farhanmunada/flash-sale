/**
 * Centralized domain error hierarchy (Pattern A: Centralized HTTP Error).
 * Services throw these; the error middleware maps them to JSON responses.
 */

import { ERROR_CODE, HTTP_STATUS } from '../constants.ts';

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code: string = ERROR_CODE.INTERNAL_ERROR,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(HTTP_STATUS.BAD_REQUEST, message, ERROR_CODE.VALIDATION_ERROR, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Autentikasi diperlukan', code = ERROR_CODE.UNAUTHORIZED) {
    super(HTTP_STATUS.UNAUTHORIZED, message, code);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Sumber daya tidak ditemukan') {
    super(HTTP_STATUS.NOT_FOUND, message, ERROR_CODE.NOT_FOUND);
  }
}

export class ConflictError extends AppError {
  constructor(message: string, code: string = ERROR_CODE.REQUEST_IN_PROGRESS) {
    super(HTTP_STATUS.CONFLICT, message, code);
  }
}

export class GoneError extends AppError {
  constructor(message: string, code: string = ERROR_CODE.SOLD_OUT) {
    super(HTTP_STATUS.GONE, message, code);
  }
}

export class RateLimitedError extends AppError {
  constructor(
    message = 'Terlalu banyak permintaan',
    public readonly retryAfterSeconds = 1,
  ) {
    super(HTTP_STATUS.TOO_MANY_REQUESTS, message, ERROR_CODE.RATE_LIMITED);
  }
}
