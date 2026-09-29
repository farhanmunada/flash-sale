/** Bookings route registration. */

import { authMiddleware } from '../../middleware/auth.middleware.ts';
import { rateLimitMiddleware } from '../../middleware/rate-limit.middleware.ts';
import { handleCreateBooking, handleGetBooking } from './bookings.controller.ts';
import type { Router } from '../../core/http/router.ts';

export function registerBookingRoutes(router: Router): void {
  router.add('POST', '/api/bookings', [rateLimitMiddleware, authMiddleware], handleCreateBooking);
  router.add('GET', '/api/bookings/:bookingId', [authMiddleware], handleGetBooking);
}
