/**
 * Tiny declarative validator (zero-dependency DTO boundary).
 * Validates external input before it reaches the service layer.
 */

import { ValidationError } from '../errors/app-error.ts';

export type FieldSpec =
  | { type: 'string'; min?: number; max?: number; optional?: boolean }
  | { type: 'email'; optional?: boolean }
  | { type: 'number'; min?: number; max?: number; optional?: boolean }
  | { type: 'uuid'; optional?: boolean };

export type Schema = Record<string, FieldSpec>;

export type InferSchema<T extends Schema> = {
  [K in keyof T]: T[K]['type'] extends 'number' ? number : string;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateField(field: string, spec: FieldSpec, value: unknown): unknown {
  if (value === undefined || value === null) {
    if (spec.optional) return undefined;
    throw new ValidationError(`Field "${field}" wajib diisi`, { field });
  }

  if (spec.type === 'number') {
    if (typeof value !== 'number' || Number.isNaN(value)) {
      throw new ValidationError(`Field "${field}" harus berupa angka`, { field });
    }
    if (spec.min !== undefined && value < spec.min) {
      throw new ValidationError(`Field "${field}" minimal ${spec.min}`, { field });
    }
    if (spec.max !== undefined && value > spec.max) {
      throw new ValidationError(`Field "${field}" maksimal ${spec.max}`, { field });
    }
    return value;
  }

  if (typeof value !== 'string') {
    throw new ValidationError(`Field "${field}" harus berupa string`, { field });
  }
  if (spec.type === 'email' && !EMAIL_PATTERN.test(value)) {
    throw new ValidationError(`Field "${field}" bukan email yang valid`, { field });
  }
  if (spec.type === 'uuid' && !UUID_PATTERN.test(value)) {
    throw new ValidationError(`Field "${field}" bukan UUID yang valid`, { field });
  }
  if (spec.type === 'string') {
    if (spec.min !== undefined && value.length < spec.min) {
      throw new ValidationError(`Field "${field}" minimal ${spec.min} karakter`, { field });
    }
    if (spec.max !== undefined && value.length > spec.max) {
      throw new ValidationError(`Field "${field}" maksimal ${spec.max} karakter`, { field });
    }
  }
  return value;
}

export function validate<T extends Schema>(schema: T, input: unknown): InferSchema<T> {
  if (typeof input !== 'object' || input === null) {
    throw new ValidationError('Body request harus berupa JSON object');
  }

  const source = input as Record<string, unknown>;
  const result: Record<string, unknown> = {};

  for (const [field, spec] of Object.entries(schema)) {
    result[field] = validateField(field, spec, source[field]);
  }

  return result as InferSchema<T>;
}

/** Parses and validates a JSON request body in one step. */
export async function parseBody<T extends Schema>(request: Request, schema: T): Promise<InferSchema<T>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new ValidationError('Body request bukan JSON yang valid');
  }
  return validate(schema, raw);
}
