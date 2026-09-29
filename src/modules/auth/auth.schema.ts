/** Auth request validation schemas. */

import { DEFAULTS } from '../../core/constants.ts';
import type { Schema } from '../../core/http/validate.ts';

export const registerSchema = {
  email: { type: 'email' },
  password: { type: 'string', min: DEFAULTS.PASSWORD_MIN_LENGTH, max: 128 },
} satisfies Schema;

export const loginSchema = {
  email: { type: 'email' },
  password: { type: 'string', min: 1, max: 128 },
} satisfies Schema;
