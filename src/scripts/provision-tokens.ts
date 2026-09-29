/**
 * Provisions load-test users and writes one JWT per line to loadtest/tokens.txt.
 *
 * Fast path (default): hashes the password once, bulk-inserts users directly,
 * and signs JWTs locally — avoids thousands of argon2id round-trips over HTTP.
 * Run with: bun run provision-tokens [count]
 */

import { sql } from '../infra/db/client.ts';
import { logger } from '../core/logger.ts';
import { signToken } from '../modules/auth/jwt.ts';

const COUNT = Number(process.argv[2] ?? 2000);
const PASSWORD = 'loadtest-password';

async function run(): Promise<void> {
  const passwordHash = await Bun.password.hash(PASSWORD, { algorithm: 'argon2id' });

  await sql.begin(async (tx) => {
    for (let index = 0; index < COUNT; index += 1) {
      await tx`
        INSERT INTO users (email, password_hash)
        VALUES (${`loadtest+${index}@example.com`}, ${passwordHash})
        ON CONFLICT (email) DO NOTHING
      `;
    }
  });
  logger.info('Inserted users', { total: COUNT });

  const users = await sql<{ id: number | string }[]>`
    SELECT id FROM users WHERE email LIKE 'loadtest+%' ORDER BY id
  `;

  const tokens: string[] = [];
  for (const user of users) {
    tokens.push(await signToken(Number(user.id)));
  }

  await Bun.write('loadtest/tokens.txt', tokens.join('\n'));
  logger.info('Tokens written', { path: 'loadtest/tokens.txt', count: tokens.length });
}

await run();
process.exit(0);
