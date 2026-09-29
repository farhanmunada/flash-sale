/**
 * Runtime environment configuration.
 * Reads and validates process.env once at startup (fail-fast on missing values).
 */

interface Env {
  readonly port: number;
  readonly nodeEnv: string;
  readonly databaseUrl: string;
  readonly redisUrl: string;
  readonly rabbitmqUrl: string;
  readonly jwtSecret: string;
  readonly jwtExpiresIn: number;
  readonly reservationTtlSeconds: number;
  readonly idempotencyTtlSeconds: number;
  readonly rateLimitCapacity: number;
  readonly rateLimitRefillPerSec: number;
}

function required(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
}

function asNumber(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (Number.isNaN(parsed)) throw new Error(`Environment variable ${key} must be a number`);
  return parsed;
}

export const env: Env = {
  port: asNumber('PORT', 3000),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  databaseUrl: required('DATABASE_URL'),
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  rabbitmqUrl: process.env.RABBITMQ_URL ?? 'amqp://guest:guest@localhost:5672',
  jwtSecret: required('JWT_SECRET'),
  jwtExpiresIn: asNumber('JWT_EXPIRES_IN', 3600),
  reservationTtlSeconds: asNumber('RESERVATION_TTL_SECONDS', 600),
  idempotencyTtlSeconds: asNumber('IDEMPOTENCY_TTL_SECONDS', 60),
  rateLimitCapacity: asNumber('RATE_LIMIT_CAPACITY', 10),
  rateLimitRefillPerSec: asNumber('RATE_LIMIT_REFILL_PER_SEC', 10),
};
