/** Bookings module types and DTOs. */

import type { BookingStatus } from '../../core/constants.ts';

export interface CreateBookingInput {
  readonly event_id: number;
  readonly quantity: number;
}

export interface BookingRow {
  readonly id: string;
  readonly user_id: number;
  readonly event_id: number;
  readonly quantity: number;
  readonly status: BookingStatus;
  readonly idempotency_key: string;
  readonly expires_at: string;
  readonly created_at: string;
}

export interface BookingResponse {
  readonly booking_id: string;
  readonly event_id: number;
  readonly quantity: number;
  readonly status: BookingStatus;
  readonly expires_at: string;
}

export interface BookingJobPayload {
  readonly bookingId: string;
  readonly userId: number;
  readonly eventId: number;
  readonly quantity: number;
  readonly expiresAt: string;
  readonly idempotencyKey: string;
}
