/**
 * Server entry point.
 * Starts Bun.serve with the application request handler.
 */

import { handleRequest } from './app.ts';
import { env } from './core/config/env.ts';
import { logger } from './core/logger.ts';

const server = Bun.serve({
  port: env.port,
  fetch: handleRequest,
});

logger.info('Server listening', { url: server.url.toString(), env: env.nodeEnv });
