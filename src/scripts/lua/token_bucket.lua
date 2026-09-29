-- Token bucket rate limiter (atomic, distributed).
-- KEYS[1]: bucket key (e.g. "rl:127.0.0.1")
-- ARGV[1]: capacity (max tokens)
-- ARGV[2]: refill rate (tokens per second)
-- ARGV[3]: current time in milliseconds
-- ARGV[4]: token cost of this request
-- Returns: { allowed (0|1), retryAfterMs }

local capacity = tonumber(ARGV[1])
local refillPerSec = tonumber(ARGV[2])
local nowMs = tonumber(ARGV[3])
local cost = tonumber(ARGV[4])

local data = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
local tokens = tonumber(data[1])
local lastTs = tonumber(data[2])
if tokens == nil then tokens = capacity end
if lastTs == nil then lastTs = nowMs end

local elapsedSec = math.max(0, nowMs - lastTs) / 1000.0
tokens = math.min(capacity, tokens + elapsedSec * refillPerSec)

if tokens < cost then
  redis.call('HMSET', KEYS[1], 'tokens', tokens, 'ts', nowMs)
  redis.call('PEXPIRE', KEYS[1], 60000)
  local missing = cost - tokens
  local retryAfterMs = math.ceil((missing / refillPerSec) * 1000)
  return { 0, retryAfterMs }
end

tokens = tokens - cost
redis.call('HMSET', KEYS[1], 'tokens', tokens, 'ts', nowMs)
redis.call('PEXPIRE', KEYS[1], 60000)
return { 1, 0 }
