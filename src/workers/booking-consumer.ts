/**
 * Booking settle worker.
 * Consumes persistence jobs and writes bookings + order_items to PostgreSQL.
 */

import { queue } from '../core/constants.ts';
import { logger } from '../core/logger.ts';
import { createChannel } from '../infra/queue/connection.ts';
import { setupTopology } from '../infra/queue/topology.ts';
import { insertBookingWithItem } from '../modules/bookings/bookings.repository.ts';
import type { BookingJob } from '../infra/queue/publisher.ts';
import type { Channel, Message } from 'amqplib';

const PREFETCH = 20;
const MAX_ATTEMPTS = 5;
const ATTEMPT_HEADER = 'x-attempt';

async function handleMessage(channel: Channel, message: Message | null): Promise<void> {
  if (!message) return;

  const job = JSON.parse(message.content.toString()) as BookingJob;
  try {
    await insertBookingWithItem({
      id: job.bookingId,
      userId: job.userId,
      eventId: job.eventId,
      quantity: job.quantity,
      idempotencyKey: job.bookingId,
      expiresAt: new Date(job.expiresAt),
    });
    channel.ack(message);
    logger.info('Booking persisted', { bookingId: job.bookingId });
  } catch (error) {
    const attempts = Number(message.properties.headers?.[ATTEMPT_HEADER] ?? 0) + 1;
    logger.error('Failed to persist booking', { bookingId: job.bookingId, attempts, error: (error as Error).message });
    channel.nack(message, false, attempts < MAX_ATTEMPTS);
  }
}

export async function startBookingConsumer(): Promise<Channel> {
  const channel = await createChannel();
  await setupTopology(channel);
  await channel.prefetch(PREFETCH);
  await channel.consume(queue.settleQueue, (message) => void handleMessage(channel, message));
  logger.info('Booking consumer started', { queue: queue.settleQueue });
  return channel;
}
