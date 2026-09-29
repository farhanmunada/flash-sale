/** Auth data access layer (SQL only). */

import { sql } from '../../infra/db/client.ts';
import { toNumber } from '../../infra/db/coerce.ts';
import type { UserRow } from './auth.types.ts';

interface RawUserRow {
  readonly id: number | string;
  readonly email: string;
  readonly password_hash: string;
}

function normalize(row: RawUserRow): UserRow {
  return { id: toNumber(row.id), email: row.email, password_hash: row.password_hash };
}

export async function findByEmail(email: string): Promise<UserRow | null> {
  const rows = await sql<RawUserRow[]>`
    SELECT id, email, password_hash FROM users WHERE email = ${email} LIMIT 1
  `;
  return rows[0] ? normalize(rows[0]) : null;
}

export async function insertUser(email: string, passwordHash: string): Promise<UserRow> {
  const rows = await sql<RawUserRow[]>`
    INSERT INTO users (email, password_hash)
    VALUES (${email}, ${passwordHash})
    RETURNING id, email, password_hash
  `;
  return normalize(rows[0]!);
}
