/**
 * Payments business logic (mock settlement).
 * Confirms a booking: PENDING -> PAID, guarding against late callbacks.
 */

import { ERROR_CODE } from '../../core/constants.ts';
import { ConflictError, NotFoundError } from '../../core/errors/app-error.ts';
import * as bookings from '../bookings/bookings.repository.ts';
import type { BookingResponse } from '../bookings/bookings.types.ts';

export async function confirmPayment(bookingId: string): Promise<BookingResponse> {
  const updated = await bookings.markPaid(bookingId);
  if (updated) {
    return {
      booking_id: updated.id,
      event_id: updated.event_id,
      quantity: updated.quantity,
      status: updated.status,
      expires_at: new Date(updated.expires_at).toISOString(),
    };
  }

  const exists = await bookings.existsById(bookingId);
  if (!exists) throw new NotFoundError('Booking tidak ditemukan');
  throw new ConflictError('Booking sudah kedaluwarsa atau tidak dapat dibayar', ERROR_CODE.BOOKING_EXPIRED);
}
