/** Events data access layer (SQL only). */

import { sql } from '../../infra/db/client.ts';
import type { TicketRow } from './events.types.ts';

export async function findTicketByEventId(eventId: number): Promise<TicketRow | null> {
  const rows = await sql<TicketRow[]>`
    SELECT id, event_id, name, price_cents, total_quota, starts_at
    FROM tickets
    WHERE event_id = ${eventId}
    ORDER BY id
    LIMIT 1
  `;
  return rows[0] ?? null;
}
