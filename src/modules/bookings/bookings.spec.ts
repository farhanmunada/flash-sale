/**
 * Unit tests for booking DTO validation.
 * End-to-end booking behavior is covered by the Tier-2 integration/load test.
 */

import { describe, expect, test } from 'bun:test';

import { ValidationError } from '../../core/errors/app-error.ts';
import { validate } from '../../core/http/validate.ts';
import { createBookingSchema } from './bookings.schema.ts';

describe('createBookingSchema', () => {
  test('accepts a valid payload', () => {
    const result = validate(createBookingSchema, { event_id: 1, quantity: 2 });
    expect(result.event_id).toBe(1);
    expect(result.quantity).toBe(2);
  });

  test('rejects a non-positive event_id', () => {
    expect(() => validate(createBookingSchema, { event_id: 0, quantity: 1 })).toThrow(ValidationError);
  });

  test('rejects quantity below the minimum', () => {
    expect(() => validate(createBookingSchema, { event_id: 1, quantity: 0 })).toThrow(ValidationError);
  });

  test('rejects quantity above the maximum', () => {
    expect(() => validate(createBookingSchema, { event_id: 1, quantity: 99 })).toThrow(ValidationError);
  });

  test('rejects a non-numeric quantity', () => {
    expect(() => validate(createBookingSchema, { event_id: 1, quantity: 'two' })).toThrow(ValidationError);
  });
});
