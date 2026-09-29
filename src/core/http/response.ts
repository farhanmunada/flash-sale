/**
 * HTTP response helpers: uniform JSON envelope and error payloads.
 */

import { ERROR_CODE } from '../constants.ts';

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const;

export function json<T>(data: T, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

export function errorResponse(status: number, code: string, message: string, details?: unknown): Response {
  const body: Record<string, unknown> = { error: { code, message } };
  if (details !== undefined) {
    (body.error as Record<string, unknown>).details = details;
  }
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

export function internalError(message = 'Terjadi kesalahan internal'): Response {
  return errorResponse(500, ERROR_CODE.INTERNAL_ERROR, message);
}
