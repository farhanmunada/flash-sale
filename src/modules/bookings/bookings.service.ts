/**
 * Bookings business logic: orchestrates the in-memory quota race
 * and hands off persistence to the async worker via RabbitMQ.
 *
 * Flow (see docs/ARCHITECTURE.md §5.5):
 *   1. idempotency acquire (replay / 409 / proceed)
 *   2. atomic stock reserve (Redis Lua) -> 410 if sold out
 *   3. create reservation (Redis, TTL)
 *   4. publish settle + expiry-delay jobs
 *   5. cache response and return PENDING
 */

import { env } from '../../core/config/env.ts';
import { redisKeys } from '../../core/constants.ts';
import { NotFoundError } from '../../core/errors/app-error.ts';
import { redis } from '../../infra/redis/client.ts';
import { publishExpiryDelay, publishSettle } from '../../infra/queue/publisher.ts';
import * as repository from './bookings.repository.ts';
import * as idempotency from './idempotency.service.ts';
import { reserveStock } from './stock.service.ts';
import type { BookingResponse, CreateBookingInput } from './bookings.types.ts';

function toResponse(
  bookingId: string,
  input: CreateBookingInput,
  expiresAt: Date,
): BookingResponse {
  return {
    booking_id: bookingId,
    event_id: input.event_id,
    quantity: input.quantity,
    status: 'PENDING',
    expires_at: expiresAt.toISOString(),
  };
}

export async function createBooking(
  userId: number,
  idempotencyKey: string,
  input: CreateBookingInput,
): Promise<BookingResponse> {
  const outcome = await idempotency.beginBooking(idempotencyKey, env.idempotencyTtlSeconds);
  if (outcome.kind === 'replay') return outcome.response;
  idempotency.assertNotInProgress(outcome);

  try {
    await reserveStock(input.event_id, input.quantity);
  } catch (error) {
    await idempotency.releaseBooking(idempotencyKey);
    throw error;
  }

  const bookingId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + env.reservationTtlSeconds * 1000);
  const response = toResponse(bookingId, input, expiresAt);

  const job = {
    bookingId,
    userId,
    eventId: input.event_id,
    quantity: input.quantity,
    expiresAt: expiresAt.toISOString(),
    idempotencyKey,
  };

  await redis.set(
    redisKeys.reservation(bookingId),
    JSON.stringify({ userId, response }),
    'EX',
    env.reservationTtlSeconds,
  );
  await publishSettle(job);
  await publishExpiryDelay(job, env.reservationTtlSeconds);
  await idempotency.completeBooking(idempotencyKey, response, env.idempotencyTtlSeconds);

  return response;
}

export async function getBooking(userId: number, bookingId: string): Promise<BookingResponse> {
  const row = await repository.findById(bookingId);
  if (row) {
    if (row.user_id !== userId) throw new NotFoundError('Booking tidak ditemukan');
    return {
      booking_id: row.id,
      event_id: row.event_id,
      quantity: row.quantity,
      status: row.status,
      expires_at: new Date(row.expires_at).toISOString(),
    };
  }

  // Worker may not have persisted yet; fall back to the in-flight reservation.
  const reservation = await readReservation(userId, bookingId);
  if (reservation) return reservation;

  throw new NotFoundError('Booking tidak ditemukan');
}

async function readReservation(userId: number, bookingId: string): Promise<BookingResponse | null> {
  const raw = await redis.get(redisKeys.reservation(bookingId));
  if (!raw) return null;
  const parsed = JSON.parse(raw) as { userId: number; response: BookingResponse };
  if (parsed.userId !== userId) return null;
  return parsed.response;
}
