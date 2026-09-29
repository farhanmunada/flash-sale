/** Bookings data access layer (SQL only). */

import { sql } from '../../infra/db/client.ts';
import type { BookingRow } from './bookings.types.ts';

export interface InsertBookingParams {
  readonly id: string;
  readonly userId: number;
  readonly eventId: number;
  readonly quantity: number;
  readonly idempotencyKey: string;
  readonly expiresAt: Date;
}

/**
 * Persists a booking and its order line atomically.
 * Uses ON CONFLICT DO NOTHING for idempotency (safe on worker retries).
 */
export async function insertBookingWithItem(params: InsertBookingParams): Promise<void> {
  await sql.begin(async (tx) => {
    const inserted = await tx<{ id: string }[]>`
      INSERT INTO bookings (id, user_id, event_id, quantity, status, idempotency_key, expires_at)
      VALUES (${params.id}, ${params.userId}, ${params.eventId}, ${params.quantity},
              'PENDING', ${params.idempotencyKey}, ${params.expiresAt})
      ON CONFLICT (idempotency_key) DO NOTHING
      RETURNING id
    `;
    if (inserted.length === 0) return;

    await tx`
      INSERT INTO order_items (booking_id, ticket_id, quantity, unit_price_cents)
      SELECT ${params.id}, t.id, ${params.quantity}, t.price_cents
      FROM tickets t
      WHERE t.event_id = ${params.eventId}
      ORDER BY t.id
      LIMIT 1
    `;
  });
}

export async function findById(bookingId: string): Promise<BookingRow | null> {
  const rows = await sql<BookingRow[]>`
    SELECT id, user_id, event_id, quantity, status, idempotency_key, expires_at, created_at
    FROM bookings
    WHERE id = ${bookingId}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

/** Transitions PENDING -> PAID. Returns the row if the transition happened. */
export async function markPaid(bookingId: string): Promise<BookingRow | null> {
  const rows = await sql<BookingRow[]>`
    UPDATE bookings SET status = 'PAID'
    WHERE id = ${bookingId} AND status = 'PENDING'
    RETURNING id, user_id, event_id, quantity, status, idempotency_key, expires_at, created_at
  `;
  return rows[0] ?? null;
}

/** Transitions PENDING -> EXPIRED. Returns the row if the transition happened. */
export async function markExpired(bookingId: string): Promise<BookingRow | null> {
  const rows = await sql<BookingRow[]>`
    UPDATE bookings SET status = 'EXPIRED'
    WHERE id = ${bookingId} AND status = 'PENDING'
    RETURNING id, user_id, event_id, quantity, status, idempotency_key, expires_at, created_at
  `;
  return rows[0] ?? null;
}

export async function existsById(bookingId: string): Promise<boolean> {
  const rows = await sql<{ exists: boolean }[]>`
    SELECT EXISTS(SELECT 1 FROM bookings WHERE id = ${bookingId}) AS exists
  `;
  return rows[0]?.exists ?? false;
}
