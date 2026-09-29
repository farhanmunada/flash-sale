/** Payments route registration. */

import { handleCallback } from './payments.controller.ts';
import type { Router } from '../../core/http/router.ts';

export function registerPaymentRoutes(router: Router): void {
  router.add('POST', '/api/payments/callback', [], handleCallback);
}
