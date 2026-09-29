/**
 * Application assembly: builds the router, registers module routes,
 * and exposes a single request handler wrapped in global error handling.
 */

import { Router } from './core/http/router.ts';
import { serveStatic } from './core/http/static.ts';
import { errorMiddleware } from './middleware/error.middleware.ts';
import { registerAuthRoutes } from './modules/auth/auth.routes.ts';
import { registerBookingRoutes } from './modules/bookings/bookings.routes.ts';
import { registerEventRoutes } from './modules/events/events.routes.ts';
import { registerPaymentRoutes } from './modules/payments/payments.routes.ts';
import { checkHealth } from './modules/health/health.service.ts';
import type { RequestContext } from './core/http/router.ts';

function buildRouter(): Router {
  const router = new Router();
  router.add('GET', '/health', [], async () => {
    const report = await checkHealth();
    return Response.json(report, { status: report.status === 'ok' ? 200 : 503 });
  });
  registerAuthRoutes(router);
  registerEventRoutes(router);
  registerBookingRoutes(router);
  registerPaymentRoutes(router);
  return router;
}

const router = buildRouter();

/** Entry point for Bun.serve: serves static assets, then API routes, with global error handling. */
export async function handleRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === 'GET') {
    const asset = await serveStatic(url.pathname);
    if (asset) return asset;
  }

  const ctx: RequestContext = { request, params: {}, query: url.searchParams };
  return errorMiddleware(ctx, () => router.handle(request));
}
