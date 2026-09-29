/** Auth data access layer (SQL only). */

import { sql } from '../../infra/db/client.ts';
import type { UserRow } from './auth.types.ts';

export async function findByEmail(email: string): Promise<UserRow | null> {
  const rows = await sql<UserRow[]>`
    SELECT id, email, password_hash FROM users WHERE email = ${email} LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function insertUser(email: string, passwordHash: string): Promise<UserRow> {
  const rows = await sql<UserRow[]>`
    INSERT INTO users (email, password_hash)
    VALUES (${email}, ${passwordHash})
    RETURNING id, email, password_hash
  `;
  return rows[0]!;
}
