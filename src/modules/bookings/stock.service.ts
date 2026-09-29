/**
 * Stock service: atomic quota operations against Redis.
 * Encapsulates the Lua decrement/rollback so booking logic stays declarative.
 */

import { STOCK_RESULT, redisKeys } from '../../core/constants.ts';
import { GoneError } from '../../core/errors/app-error.ts';
import { decrementStock, incrementStock } from '../../infra/redis/scripts.ts';
import { logger } from '../../core/logger.ts';

export interface StockReservation {
  readonly remaining: number;
}

/**
 * Atomically reserves `quantity` tickets for an event.
 * Throws GoneError (SOLD_OUT) when the quota key is missing or insufficient.
 */
export async function reserveStock(eventId: number, quantity: number): Promise<StockReservation> {
  const remaining = await decrementStock(redisKeys.quota(eventId), quantity);

  if (remaining === STOCK_RESULT.KEY_MISSING || remaining === STOCK_RESULT.INSUFFICIENT) {
    throw new GoneError('Kuota tiket habis');
  }

  return { remaining };
}

/** Returns reserved tickets to the pool (used by the expiry worker). */
export async function releaseStock(eventId: number, quantity: number): Promise<void> {
  const remaining = await incrementStock(redisKeys.quota(eventId), quantity);
  logger.info('Stock released', { eventId, quantity, remaining });
}
