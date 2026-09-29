/** Bookings HTTP layer. */

import { AppError, ValidationError } from '../../core/errors/app-error.ts';
import { ERROR_CODE, HTTP_STATUS } from '../../core/constants.ts';
import { json } from '../../core/http/response.ts';
import { parseBody } from '../../core/http/validate.ts';
import { createBookingSchema } from './bookings.schema.ts';
import * as service from './bookings.service.ts';
import type { RequestContext } from '../../core/http/router.ts';

function requireUserId(ctx: RequestContext): number {
  if (ctx.userId === undefined) throw new ValidationError('User tidak terautentikasi');
  return ctx.userId;
}

function requireIdempotencyKey(ctx: RequestContext): string {
  const key = ctx.request.headers.get('idempotency-key');
  if (!key) {
    throw new AppError(
      HTTP_STATUS.BAD_REQUEST,
      'Header Idempotency-Key wajib disertakan',
      ERROR_CODE.MISSING_IDEMPOTENCY_KEY,
    );
  }
  return key;
}

export async function handleCreateBooking(ctx: RequestContext): Promise<Response> {
  const userId = requireUserId(ctx);
  const idempotencyKey = requireIdempotencyKey(ctx);
  const input = await parseBody(ctx.request, createBookingSchema);
  const result = await service.createBooking(userId, idempotencyKey, input);
  return json(result, HTTP_STATUS.ACCEPTED);
}

export async function handleGetBooking(ctx: RequestContext): Promise<Response> {
  const userId = requireUserId(ctx);
  const bookingId = ctx.params.bookingId!;
  const result = await service.getBooking(userId, bookingId);
  return json(result, HTTP_STATUS.OK);
}
