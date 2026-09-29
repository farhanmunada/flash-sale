/** Bookings request validation schemas. */

import { DEFAULTS } from '../../core/constants.ts';
import type { Schema } from '../../core/http/validate.ts';

export const createBookingSchema = {
  event_id: { type: 'number', min: 1 },
  quantity: { type: 'number', min: DEFAULTS.QUANTITY_MIN, max: DEFAULTS.QUANTITY_MAX },
} satisfies Schema;
