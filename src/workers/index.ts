/**
 * Worker entry point: starts all consumers in a single process.
 * Run with: bun run worker
 */

import { logger } from '../core/logger.ts';
import { startBookingConsumer } from './booking-consumer.ts';
import { startExpiryConsumer } from './expiry-consumer.ts';

await startBookingConsumer();
await startExpiryConsumer();
logger.info('All workers running');

process.on('SIGINT', () => {
  logger.info('Workers shutting down');
  process.exit(0);
});
