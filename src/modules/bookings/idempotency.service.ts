/**
 * Idempotency service: acquire/complete/replay semantics backed by Redis.
 *
 * States stored under idem:<key>:
 *   - "PROCESSING"  -> a request with this key is currently in flight
 *   - JSON string   -> the completed response, replayed on duplicate requests
 */

import { IDEMPOTENCY_STATE, redisKeys } from '../../core/constants.ts';
import { ConflictError } from '../../core/errors/app-error.ts';
import { redis } from '../../infra/redis/client.ts';
import { acquireIdempotencyKey } from '../../infra/redis/scripts.ts';
import type { BookingResponse } from './bookings.types.ts';

export type IdempotencyOutcome =
  | { readonly kind: 'acquired' }
  | { readonly kind: 'in_progress' }
  | { readonly kind: 'replay'; readonly response: BookingResponse };

export async function beginBooking(idempotencyKey: string, ttlSeconds: number): Promise<IdempotencyOutcome> {
  const { acquired, existing } = await acquireIdempotencyKey(redisKeys.idempotency(idempotencyKey), ttlSeconds);

  if (acquired) return { kind: 'acquired' };
  if (existing === IDEMPOTENCY_STATE.PROCESSING) return { kind: 'in_progress' };

  return { kind: 'replay', response: JSON.parse(existing) as BookingResponse };
}

/** Stores the final response so future duplicates can be replayed. */
export async function completeBooking(
  idempotencyKey: string,
  response: BookingResponse,
  ttlSeconds: number,
): Promise<void> {
  await redis.set(redisKeys.idempotency(idempotencyKey), JSON.stringify(response), 'EX', ttlSeconds);
}

/** Frees the idempotency key so the client may retry after a failure. */
export async function releaseBooking(idempotencyKey: string): Promise<void> {
  await redis.del(redisKeys.idempotency(idempotencyKey));
}

export function assertNotInProgress(outcome: IdempotencyOutcome): void {
  if (outcome.kind === 'in_progress') {
    throw new ConflictError('Permintaan dengan idempotency key ini sedang diproses');
  }
}
