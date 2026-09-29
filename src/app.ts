/**
 * Application assembly: builds the router, registers module routes,
 * and exposes a single request handler wrapped in global error handling.
 */

import { Router } from './core/http/router.ts';
import { errorMiddleware } from './middleware/error.middleware.ts';
import { registerAuthRoutes } from './modules/auth/auth.routes.ts';
import { registerBookingRoutes } from './modules/bookings/bookings.routes.ts';
import { registerEventRoutes } from './modules/events/events.routes.ts';
import type { RequestContext } from './core/http/router.ts';

function buildRouter(): Router {
  const router = new Router();
  router.add('GET', '/health', [], async () => Response.json({ status: 'ok' }));
  registerAuthRoutes(router);
  registerEventRoutes(router);
  registerBookingRoutes(router);
  return router;
}

const router = buildRouter();

/** Entry point for Bun.serve: applies the global error middleware around routing. */
export async function handleRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const ctx: RequestContext = { request, params: {}, query: url.searchParams };
  return errorMiddleware(ctx, () => router.handle(request));
}
