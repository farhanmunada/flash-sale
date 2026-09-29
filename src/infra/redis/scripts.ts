/**
 * Loads Lua scripts once and exposes typed wrappers around EVAL.
 * Scripts are read from disk at module init (single source of truth).
 */

import { redis } from './client.ts';

const LUA_DIR = new URL('../../scripts/lua/', import.meta.url);

const decrementStockScript = await Bun.file(new URL('decrement_stock.lua', LUA_DIR)).text();
const tokenBucketScript = await Bun.file(new URL('token_bucket.lua', LUA_DIR)).text();
const idempotencyAcquireScript = await Bun.file(new URL('idempotency_acquire.lua', LUA_DIR)).text();

/**
 * Atomically decrements stock.
 * @returns remaining stock (>=0), or -1 (key missing) / -2 (insufficient).
 */
export async function decrementStock(quotaKey: string, quantity: number): Promise<number> {
  const result = await redis.eval(decrementStockScript, 1, quotaKey, quantity);
  return Number(result);
}

export async function incrementStock(quotaKey: string, quantity: number): Promise<number> {
  return redis.incrby(quotaKey, quantity);
}

export async function readStock(quotaKey: string): Promise<number> {
  const raw = await redis.get(quotaKey);
  return raw === null ? -1 : Number(raw);
}

export interface RateLimitResult {
  readonly allowed: boolean;
  readonly retryAfterMs: number;
}

export async function consumeTokenBucket(
  bucketKey: string,
  capacity: number,
  refillPerSec: number,
  cost: number,
): Promise<RateLimitResult> {
  const nowMs = Date.now();
  const result = (await redis.eval(
    tokenBucketScript,
    1,
    bucketKey,
    capacity,
    refillPerSec,
    nowMs,
    cost,
  )) as [number, number];

  return { allowed: Number(result[0]) === 1, retryAfterMs: Number(result[1]) };
}

export interface IdempotencyAcquireResult {
  readonly acquired: boolean;
  /** Existing value when not acquired: "PROCESSING" or a stored JSON response. */
  readonly existing: string;
}

export async function acquireIdempotencyKey(
  idempotencyKey: string,
  ttlSeconds: number,
): Promise<IdempotencyAcquireResult> {
  const result = (await redis.eval(
    idempotencyAcquireScript,
    1,
    idempotencyKey,
    ttlSeconds,
  )) as [number, string];

  return { acquired: Number(result[0]) === 1, existing: String(result[1]) };
}
