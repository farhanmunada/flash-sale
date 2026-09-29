/** Events data access layer (SQL only). */

import { sql } from '../../infra/db/client.ts';
import { toNumber } from '../../infra/db/coerce.ts';
import type { TicketRow } from './events.types.ts';

interface RawTicketRow {
  readonly id: number | string;
  readonly event_id: number | string;
  readonly name: string;
  readonly price_cents: number | string;
  readonly total_quota: number | string;
  readonly starts_at: string | Date | null;
}

export async function findTicketByEventId(eventId: number): Promise<TicketRow | null> {
  const rows = await sql<RawTicketRow[]>`
    SELECT id, event_id, name, price_cents, total_quota, starts_at
    FROM tickets
    WHERE event_id = ${eventId}
    ORDER BY id
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;

  return {
    id: toNumber(row.id),
    event_id: toNumber(row.event_id),
    name: row.name,
    price_cents: toNumber(row.price_cents),
    total_quota: toNumber(row.total_quota),
    starts_at: row.starts_at ? new Date(row.starts_at).toISOString() : null,
  };
}
