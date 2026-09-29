/** Events route registration. */

import { handleGetEvent, handleGetQuota } from './events.controller.ts';
import type { Router } from '../../core/http/router.ts';

export function registerEventRoutes(router: Router): void {
  router.add('GET', '/api/events/:eventId/quota', [], handleGetQuota);
  router.add('GET', '/api/events/:eventId', [], handleGetEvent);
}
