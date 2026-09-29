/**
 * Post-load-test integrity verification.
 * Confirms exactly `expected` bookings were created and quota hit zero.
 * Run with: bun run src/scripts/verify-integrity.ts [eventId] [expected]
 */

import { redisKeys } from '../core/constants.ts';
import { logger } from '../core/logger.ts';
import { sql } from '../infra/db/client.ts';
import { redis } from '../infra/redis/client.ts';

const eventId = Number(process.argv[2] ?? 1);
const expected = Number(process.argv[3] ?? 100);

async function verify(): Promise<boolean> {
  const countRows = await sql<{ count: number }[]>`
    SELECT COUNT(*)::int AS count FROM bookings WHERE event_id = ${eventId}
  `;
  const bookingCount = countRows[0]?.count ?? 0;

  const quotaRaw = await redis.get(redisKeys.quota(eventId));
  const remaining = quotaRaw === null ? -1 : Number(quotaRaw);

  const ok = bookingCount === expected && remaining === 0;
  logger.info('Integrity check', { eventId, bookingCount, expected, remaining, ok });
  return ok;
}

const ok = await verify();
process.exit(ok ? 0 : 1);
