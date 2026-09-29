/**
 * PostgreSQL BIGINT (int8) values are returned by Bun.sql as strings to avoid
 * precision loss. Domain ids in this system fit safely in a JS number, so we
 * normalize them at the repository boundary to keep types honest.
 */

export function toNumber(value: number | string | bigint): number {
  if (typeof value === 'number') return value;
  return Number(value);
}
