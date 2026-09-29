/**
 * RabbitMQ connection manager.
 * Exposes a lazily created shared connection and channel factory.
 */

import amqp from 'amqplib';

import { env } from '../../core/config/env.ts';
import { logger } from '../../core/logger.ts';
import type { Channel, Connection } from 'amqplib';

let connection: Connection | null = null;

export async function getConnection(): Promise<Connection> {
  if (connection) return connection;

  connection = await amqp.connect(env.rabbitmqUrl);
  connection.on('error', (error) => logger.error('RabbitMQ connection error', { error: error?.message }));
  connection.on('close', () => {
    logger.warn('RabbitMQ connection closed');
    connection = null;
  });
  logger.info('RabbitMQ connected');
  return connection;
}

export async function createChannel(): Promise<Channel> {
  const conn = await getConnection();
  const channel = await conn.createChannel();
  channel.on('error', (error) => logger.error('RabbitMQ channel error', { error: error?.message }));
  return channel;
}

export async function closeConnection(): Promise<void> {
  if (!connection) return;
  await connection.close();
  connection = null;
}
