/**
 * Provisions load-test users and writes one JWT per line to loadtest/tokens.txt.
 * Run with: bun run src/scripts/provision-tokens.ts [count]
 *
 * Requires the API server to be running (registers + logs in each user).
 */

import { logger } from '../core/logger.ts';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';
const COUNT = Number(process.argv[2] ?? 2000);
const BATCH = 50;

async function ensureUser(index: number): Promise<string> {
  const email = `loadtest+${index}@example.com`;
  const password = 'loadtest-password';

  await fetch(`${BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  const login = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = (await login.json()) as { token?: string };
  if (!body.token) throw new Error(`Login failed for ${email}`);
  return body.token;
}

async function run(): Promise<void> {
  const tokens: string[] = [];
  for (let start = 0; start < COUNT; start += BATCH) {
    const end = Math.min(start + BATCH, COUNT);
    const batch = await Promise.all(
      Array.from({ length: end - start }, (_, offset) => ensureUser(start + offset)),
    );
    tokens.push(...batch);
    logger.info('Provisioned tokens', { done: end, total: COUNT });
  }

  await Bun.write('loadtest/tokens.txt', tokens.join('\n'));
  logger.info('Tokens written', { path: 'loadtest/tokens.txt', count: tokens.length });
}

await run();
process.exit(0);
