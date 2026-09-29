-- Atomic stock decrement.
-- KEYS[1]: quota key (e.g. "ticket:1:quota")
-- ARGV[1]: requested quantity
-- Returns: -1 key missing | -2 insufficient stock | >=0 remaining stock after decrement

local stock = tonumber(redis.call('GET', KEYS[1]))
if stock == nil then
  return -1
end

local requested = tonumber(ARGV[1])
if stock < requested then
  return -2
end

return redis.call('DECRBY', KEYS[1], requested)
