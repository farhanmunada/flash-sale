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
}

let channel: Channel | null = null;

async function getPublisherChannel(): Promise<Channel> {
  if (channel) return channel;
  channel = await ensureTopology();
  return channel;
}

function publishTo(target: { exchange: string; routingKey: string }, job: BookingJob, expiration?: string): void {
  const body = Buffer.from(JSON.stringify(job));
  const options = {
    persistent: true,
    contentType: 'application/json',
    messageId: job.bookingId,
    ...(expiration ? { expiration } : {}),
  };
  channel!.publish(target.exchange, target.routingKey, body, options);
}

/** Publishes the persistence job (consumed immediately by the booking worker). */
export async function publishSettle(job: BookingJob): Promise<void> {
  await getPublisherChannel();
  publishTo({ exchange: queue.exchange, routingKey: queue.routing.settle }, job);
  logger.debug('Published settle job', { bookingId: job.bookingId });
}

/** Publishes the delayed expiry job (dead-letters after TTL if unpaid). */
export async function publishExpiryDelay(job: BookingJob, ttlSeconds: number): Promise<void> {
  await getPublisherChannel();
  const expirationMs = String(ttlSeconds * 1000);
  publishTo({ exchange: queue.exchange, routingKey: queue.routing.expiryDelay }, job, expirationMs);
  logger.debug('Published expiry delay job', { bookingId: job.bookingId, ttlSeconds });
}

export async function closePublisher(): Promise<void> {
  if (!channel) return;
  await channel.close();
  channel = null;
}
