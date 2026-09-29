/**
 * Token bucket rate limiter middleware (Redis Lua, atomic).
 * Keyed by client IP. Applied to the booking endpoint.
 */

import { env } from '../core/config/env.ts';
import { redisKeys } from '../core/constants.ts';
import { RateLimitedError } from '../core/errors/app-error.ts';
import { consumeTokenBucket } from '../infra/redis/scripts.ts';
import type { Middleware } from '../core/http/router.ts';

function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]!.trim();
  return request.headers.get('x-real-ip') ?? 'unknown';
}

export const rateLimitMiddleware: Middleware = async (ctx, next) => {
  const ip = clientIp(ctx.request);
  const result = await consumeTokenBucket(
    redisKeys.rateLimit(ip),
    env.rateLimitCapacity,
    env.rateLimitRefillPerSec,
    1,
  );

  if (!result.allowed) {
    const retryAfterSeconds = Math.max(1, Math.ceil(result.retryAfterMs / 1000));
    throw new RateLimitedError('Terlalu banyak permintaan, coba lagi sebentar', retryAfterSeconds);
  }

  return next();
};
