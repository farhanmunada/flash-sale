/**
 * Seed script: creates a demo event + ticket and primes the Redis quota key.
 * Run with: bun run seed [eventId] [quota]
 */

import { redisKeys } from '../core/constants.ts';
import { logger } from '../core/logger.ts';
import { sql } from '../infra/db/client.ts';
import { redis } from '../infra/redis/client.ts';

const DEFAULT_EVENT_ID = 1;
const DEFAULT_QUOTA = 100;
const DEFAULT_PRICE_CENTS = 25_000_000;

async function seed(eventId: number, quota: number): Promise<void> {
  // Idempotent: reset any previous data for this event so re-seeding is safe.
  await sql`DELETE FROM order_items WHERE booking_id IN (SELECT id FROM bookings WHERE event_id = ${eventId})`;
  await sql`DELETE FROM bookings WHERE event_id = ${eventId}`;
  await sql`DELETE FROM tickets WHERE event_id = ${eventId}`;

  await sql`
    INSERT INTO tickets (event_id, name, price_cents, total_quota, starts_at)
    VALUES (${eventId}, ${'Konser Malam Nusantara'}, ${DEFAULT_PRICE_CENTS}, ${quota}, NOW() + INTERVAL '7 days')
  `;

  await redis.set(redisKeys.quota(eventId), String(quota));
  logger.info('Seed complete', { eventId, quota });
}

const eventId = Number(process.argv[2] ?? DEFAULT_EVENT_ID);
const quota = Number(process.argv[3] ?? DEFAULT_QUOTA);

try {
  await seed(eventId, quota);
  process.exit(0);
} catch (error) {
  logger.error('Seed failed', { error: (error as Error).message });
  process.exit(1);
}
