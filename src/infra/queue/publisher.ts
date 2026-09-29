/**
 * Publishes booking jobs to RabbitMQ.
 * A single channel is reused; both settle and expiry-delay messages are emitted.
 */

import { queue } from '../../core/constants.ts';
import { logger } from '../../core/logger.ts';
import { ensureTopology } from './topology.ts';
import type { Channel } from 'amqplib';

export interface BookingJob {
  readonly bookingId: string;
  readonly userId: number;
  readonly eventId: number;
  readonly quantity: number;
  readonly expiresAt: string;
  readonly idempotencyKey: string;
}

let channelPromise: Promise<Channel> | null = null;

/**
 * Returns the shared publisher channel.
 * The *promise* is memoized (not the resolved channel) so that concurrent
 * callers share a single in-flight topology setup instead of each creating
 * their own channel.
 */
function getPublisherChannel(): Promise<Channel> {
  if (!channelPromise) {
    channelPromise = ensureTopology().catch((error) => {
      channelPromise = null; // allow retry after a failed setup
      throw error;
    });
  }
  return channelPromise;
}

function publishTo(
  channel: Channel,
  target: { exchange: string; routingKey: string },
  job: BookingJob,
  expiration?: string,
): void {
  const body = Buffer.from(JSON.stringify(job));
  const options = {
    persistent: true,
    contentType: 'application/json',
    messageId: job.bookingId,
    ...(expiration ? { expiration } : {}),
  };
  channel.publish(target.exchange, target.routingKey, body, options);
}

/** Publishes the persistence job (consumed immediately by the booking worker). */
export async function publishSettle(job: BookingJob): Promise<void> {
  const channel = await getPublisherChannel();
  publishTo(channel, { exchange: queue.exchange, routingKey: queue.routing.settle }, job);
  logger.debug('Published settle job', { bookingId: job.bookingId });
}

/** Publishes the delayed expiry job (dead-letters after TTL if unpaid). */
export async function publishExpiryDelay(job: BookingJob, ttlSeconds: number): Promise<void> {
  const channel = await getPublisherChannel();
  const expirationMs = String(ttlSeconds * 1000);
  publishTo(
    channel,
    { exchange: queue.exchange, routingKey: queue.routing.expiryDelay },
    job,
    expirationMs,
  );
  logger.debug('Published expiry delay job', { bookingId: job.bookingId, ttlSeconds });
}

export async function closePublisher(): Promise<void> {
  if (!channelPromise) return;
  const channel = await channelPromise;
  await channel.close();
  channelPromise = null;
}
