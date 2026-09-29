/**
 * Expiry worker.
 * Consumes dead-lettered expiry jobs. If the booking is still PENDING,
 * transitions it to EXPIRED and returns the reserved quota to Redis.
 */

import { queue } from '../core/constants.ts';
import { logger } from '../core/logger.ts';
import { createChannel } from '../infra/queue/connection.ts';
import { setupTopology } from '../infra/queue/topology.ts';
import { markExpired } from '../modules/bookings/bookings.repository.ts';
import { releaseStock } from '../modules/bookings/stock.service.ts';
import type { BookingJob } from '../infra/queue/publisher.ts';
import type { Channel, Message } from 'amqplib';

const PREFETCH = 20;

async function handleMessage(channel: Channel, message: Message | null): Promise<void> {
  if (!message) return;

  const job = JSON.parse(message.content.toString()) as BookingJob;
  try {
    // Guard: only the PENDING -> EXPIRED transition owner rolls back stock.
    const expired = await markExpired(job.bookingId);
    if (expired) {
      await releaseStock(job.eventId, job.quantity);
      logger.info('Booking expired and stock released', { bookingId: job.bookingId, quantity: job.quantity });
    } else {
      logger.info('Booking already settled; skipping rollback', { bookingId: job.bookingId });
    }
    channel.ack(message);
  } catch (error) {
    logger.error('Failed to process expiry', { bookingId: job.bookingId, error: (error as Error).message });
    channel.nack(message, false, true);
  }
}

export async function startExpiryConsumer(): Promise<Channel> {
  const channel = await createChannel();
  await setupTopology(channel);
  await channel.prefetch(PREFETCH);
  await channel.consume(queue.expiryQueue, (message) => void handleMessage(channel, message));
  logger.info('Expiry consumer started', { queue: queue.expiryQueue });
  return channel;
}
