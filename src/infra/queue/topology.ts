/**
 * Declares the RabbitMQ topology: main exchange, settle queue,
 * expiry delay queue (TTL -> dead letter) and the DLX expiry queue.
 */

import { queue } from '../../core/constants.ts';
import { logger } from '../../core/logger.ts';
import { createChannel } from './connection.ts';
import type { Channel } from 'amqplib';

export async function setupTopology(channel: Channel): Promise<void> {
  await channel.assertExchange(queue.exchange, 'direct', { durable: true });
  await channel.assertExchange(queue.dlx, 'direct', { durable: true });

  await channel.assertQueue(queue.settleQueue, { durable: true });
  await channel.bindQueue(queue.settleQueue, queue.exchange, queue.routing.settle);

  await channel.assertQueue(queue.expiryDelayQueue, {
    durable: true,
    arguments: {
      'x-dead-letter-exchange': queue.dlx,
      'x-dead-letter-routing-key': queue.routing.expiry,
    },
  });
  await channel.bindQueue(queue.expiryDelayQueue, queue.exchange, queue.routing.expiryDelay);

  await channel.assertQueue(queue.expiryQueue, { durable: true });
  await channel.bindQueue(queue.expiryQueue, queue.dlx, queue.routing.expiry);

  logger.info('RabbitMQ topology ready');
}

export async function ensureTopology(): Promise<Channel> {
  const channel = await createChannel();
  await setupTopology(channel);
  return channel;
}
