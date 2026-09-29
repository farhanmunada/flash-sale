/**
 * Shared constants: status enums, Redis key builders, queue names, HTTP codes.
 * Centralized to eliminate magic values across the codebase.
 */

export const BOOKING_STATUS = {
  PENDING: 'PENDING',
  PAID: 'PAID',
  EXPIRED: 'EXPIRED',
  CANCELLED: 'CANCELLED',
} as const;

export type BookingStatus = (typeof BOOKING_STATUS)[keyof typeof BOOKING_STATUS];

export const IDEMPOTENCY_STATE = {
  PROCESSING: 'PROCESSING',
} as const;

export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  ACCEPTED: 202,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  NOT_FOUND: 404,
  CONFLICT: 409,
  GONE: 410,
  TOO_MANY_REQUESTS: 429,
  INTERNAL: 500,
  SERVICE_UNAVAILABLE: 503,
} as const;

export const ERROR_CODE = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  EMAIL_ALREADY_EXISTS: 'EMAIL_ALREADY_EXISTS',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  UNAUTHORIZED: 'UNAUTHORIZED',
  MISSING_IDEMPOTENCY_KEY: 'MISSING_IDEMPOTENCY_KEY',
  REQUEST_IN_PROGRESS: 'REQUEST_IN_PROGRESS',
  SOLD_OUT: 'SOLD_OUT',
  RATE_LIMITED: 'RATE_LIMITED',
  NOT_FOUND: 'NOT_FOUND',
  BOOKING_EXPIRED: 'BOOKING_EXPIRED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

/** Redis key builders — single source of truth for key space. */
export const redisKeys = {
  quota: (eventId: number | string): string => `ticket:${eventId}:quota`,
  reservation: (bookingId: string): string => `reservation:${bookingId}`,
  idempotency: (key: string): string => `idem:${key}`,
  rateLimit: (ip: string): string => `rl:${ip}`,
} as const;

/** RabbitMQ topology names. */
export const queue = {
  exchange: 'booking.exchange',
  dlx: 'booking.dlx',
  settleQueue: 'booking.settle',
  expiryDelayQueue: 'booking.expiry.delay',
  expiryQueue: 'booking.expiry',
  routing: {
    settle: 'booking.settle',
    expiryDelay: 'booking.expiry.delay',
    expiry: 'booking.expiry',
  },
} as const;

/** Lua script return sentinels for the stock decrement script. */
export const STOCK_RESULT = {
  KEY_MISSING: -1,
  INSUFFICIENT: -2,
} as const;

export const DEFAULTS = {
  IDEMPOTENCY_TTL_SECONDS: 60,
  RESERVATION_TTL_SECONDS: 600,
  JWT_EXPIRES_IN_SECONDS: 3600,
  PASSWORD_MIN_LENGTH: 8,
  QUANTITY_MIN: 1,
  QUANTITY_MAX: 5,
} as const;
