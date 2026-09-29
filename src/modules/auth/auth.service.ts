/** Auth business logic: registration and login with argon2id hashing. */

import { ERROR_CODE } from '../../core/constants.ts';
import { ConflictError, UnauthorizedError } from '../../core/errors/app-error.ts';
import { env } from '../../core/config/env.ts';
import * as repository from './auth.repository.ts';
import { signToken } from './jwt.ts';
import type { LoginInput, LoginResult, PublicUser, RegisterInput } from './auth.types.ts';

export async function register(input: RegisterInput): Promise<PublicUser> {
  const existing = await repository.findByEmail(input.email);
  if (existing) {
    throw new ConflictError('Email sudah terdaftar', ERROR_CODE.EMAIL_ALREADY_EXISTS);
  }

  const passwordHash = await Bun.password.hash(input.password, { algorithm: 'argon2id' });
  const user = await repository.insertUser(input.email, passwordHash);
  return { user_id: user.id, email: user.email };
}

export async function login(input: LoginInput): Promise<LoginResult> {
  const user = await repository.findByEmail(input.email);
  if (!user) {
    throw new UnauthorizedError('Email atau password salah', ERROR_CODE.INVALID_CREDENTIALS);
  }

  const valid = await Bun.password.verify(input.password, user.password_hash);
  if (!valid) {
    throw new UnauthorizedError('Email atau password salah', ERROR_CODE.INVALID_CREDENTIALS);
  }

  const token = await signToken(user.id);
  return { token, expires_in: env.jwtExpiresIn };
}
