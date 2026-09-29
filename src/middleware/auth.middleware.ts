/**
 * Bearer JWT authentication middleware.
 * Populates ctx.userId on success; throws UnauthorizedError otherwise.
 */

import { UnauthorizedError } from '../core/errors/app-error.ts';
import { verifyToken } from '../modules/auth/jwt.ts';
import type { Middleware } from '../core/http/router.ts';

export const authMiddleware: Middleware = async (ctx, next) => {
  const header = ctx.request.headers.get('authorization');
  if (!header?.startsWith('Bearer ')) {
    throw new UnauthorizedError('Header Authorization dengan Bearer token diperlukan');
  }

  const token = header.slice('Bearer '.length).trim();
  const payload = await verifyToken(token);
  if (!payload) {
    throw new UnauthorizedError('Token tidak valid atau sudah kedaluwarsa');
  }

  ctx.userId = payload.sub;
  return next();
};
