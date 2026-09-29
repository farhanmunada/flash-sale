/**
 * Redis connection singleton.
 * Uses Bun's native Redis client (RESP3). Requires Redis server >= 7.2.
 */

import { RedisClient } from 'bun';

import { env } from '../../core/config/env.ts';

export const redis = new RedisClient(env.redisUrl, {
  enableAutoPipelining: true,
  autoReconnect: true,
});

export async function pingRedis(): Promise<boolean> {
  try {
    const reply = await redis.send('PING', []);
    return reply === 'PONG';
  } catch {
    return false;
  }
}
