/**
 * Health check aggregation for Redis, PostgreSQL and RabbitMQ.
 * Returns a structured snapshot so orchestrators can gate traffic on it.
 */

import { pingRedis } from '../../infra/redis/client.ts';
import { pingDatabase } from '../../infra/db/client.ts';
import { getConnection } from '../../infra/queue/connection.ts';

export interface HealthReport {
  readonly status: 'ok' | 'degraded';
  readonly dependencies: {
    readonly redis: boolean;
    readonly database: boolean;
    readonly queue: boolean;
  };
}

async function pingQueue(): Promise<boolean> {
  try {
    const connection = await getConnection();
    return Boolean(connection);
  } catch {
    return false;
  }
}

export async function checkHealth(): Promise<HealthReport> {
  const [redis, database, queue] = await Promise.all([
    pingRedis(),
    pingDatabase(),
    pingQueue(),
  ]);

  const allUp = redis && database && queue;
  return {
    status: allUp ? 'ok' : 'degraded',
    dependencies: { redis, database, queue },
  };
}
