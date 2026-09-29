/**
 * Migration runner: applies schema.sql idempotently.
 * Run with: bun run migrate
 */

import { sql } from './client.ts';
import { logger } from '../../core/logger.ts';

const schemaPath = new URL('./schema.sql', import.meta.url);

async function migrate(): Promise<void> {
  const ddl = await Bun.file(schemaPath).text();
  logger.info('Applying schema', { path: schemaPath.pathname });
  await sql.unsafe(ddl);
  logger.info('Schema applied successfully');
}

try {
  await migrate();
  process.exit(0);
} catch (error) {
  logger.error('Migration failed', { error: (error as Error).message });
  process.exit(1);
}
