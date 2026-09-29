/**
 * Unit tests for auth helpers that don't require a database:
 * JWT sign/verify and DTO validation.
 */

import { describe, expect, test } from 'bun:test';

import { ValidationError } from '../../core/errors/app-error.ts';
import { validate } from '../../core/http/validate.ts';
import { loginSchema, registerSchema } from './auth.schema.ts';
import { signToken, verifyToken } from './jwt.ts';

describe('jwt', () => {
  test('signs and verifies a token round-trip', async () => {
    const token = await signToken(42);
    const payload = await verifyToken(token);
    expect(payload?.sub).toBe(42);
    expect(payload?.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  test('rejects a tampered token', async () => {
    const token = await signToken(42);
    const tampered = `${token.slice(0, -1)}x`;
    expect(await verifyToken(tampered)).toBeNull();
  });

  test('rejects a malformed token', async () => {
    expect(await verifyToken('not-a-jwt')).toBeNull();
  });
});

describe('auth schema validation', () => {
  test('accepts a valid registration payload', () => {
    const result = validate(registerSchema, { email: 'a@b.com', password: 'secret123' });
    expect(result.email).toBe('a@b.com');
  });

  test('rejects a malformed email', () => {
    expect(() => validate(registerSchema, { email: 'nope', password: 'secret123' })).toThrow(ValidationError);
  });

  test('rejects a short password', () => {
    expect(() => validate(registerSchema, { email: 'a@b.com', password: 'short' })).toThrow(ValidationError);
  });

  test('login schema requires both fields', () => {
    expect(() => validate(loginSchema, { email: 'a@b.com' })).toThrow(ValidationError);
  });
});
