/**
 * PostgreSQL connection via Bun's native SQL client.
 * Pooling and prepared statements are handled by Bun.sql automatically.
 */

import { SQL } from 'bun';

import { env } from '../../core/config/env.ts';

export const sql = new SQL(env.databaseUrl, {
  max: 20,
  idleTimeout: 30,
});

export async function pingDatabase(): Promise<boolean> {
  try {
    await sql`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}
