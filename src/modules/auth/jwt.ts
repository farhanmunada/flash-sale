/**
 * Minimal JWT (HS256) sign/verify using WebCrypto. Zero-dependency.
 */

import { env } from '../../core/config/env.ts';

export interface JwtPayload {
  readonly sub: number;
  readonly exp: number;
}

const ALGORITHM = { name: 'HMAC', hash: 'SHA-256' } as const;

function base64UrlEncode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

function base64UrlDecodeToString(input: string): string {
  return Buffer.from(input, 'base64url').toString('utf8');
}

async function getKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.jwtSecret),
    ALGORITHM,
    false,
    ['sign', 'verify'],
  );
}

async function sign(data: string): Promise<string> {
  const key = await getKey();
  const signature = await crypto.subtle.sign(ALGORITHM, key, new TextEncoder().encode(data));
  return base64UrlEncode(new Uint8Array(signature));
}

export async function signToken(userId: number): Promise<string> {
  const header = base64UrlEncode(new TextEncoder().encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const exp = Math.floor(Date.now() / 1000) + env.jwtExpiresIn;
  const payload = base64UrlEncode(new TextEncoder().encode(JSON.stringify({ sub: userId, exp })));
  const signature = await sign(`${header}.${payload}`);
  return `${header}.${payload}.${signature}`;
}

export async function verifyToken(token: string): Promise<JwtPayload | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [header, payload, signature] = parts as [string, string, string];
  const expected = await sign(`${header}.${payload}`);
  if (expected !== signature) return null;

  try {
    const decoded = JSON.parse(base64UrlDecodeToString(payload)) as JwtPayload;
    if (typeof decoded.sub !== 'number' || typeof decoded.exp !== 'number') return null;
    if (decoded.exp < Math.floor(Date.now() / 1000)) return null;
    return decoded;
  } catch {
    return null;
  }
}
