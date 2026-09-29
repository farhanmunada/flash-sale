-- Idempotency acquire (set-if-not-exists with TTL).
-- KEYS[1]: idempotency key (e.g. "idem:<uuid>")
-- ARGV[1]: ttl in seconds
-- Returns: { acquired (0|1), existingValue ("" when newly acquired) }

local existing = redis.call('GET', KEYS[1])
if existing then
  return { 0, existing }
end

redis.call('SET', KEYS[1], 'PROCESSING', 'EX', tonumber(ARGV[1]))
return { 1, '' }
