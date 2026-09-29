/** Auth route registration. */

import { handleLogin, handleRegister } from './auth.controller.ts';
import type { Router } from '../../core/http/router.ts';

export function registerAuthRoutes(router: Router): void {
  router.add('POST', '/api/auth/register', [], handleRegister);
  router.add('POST', '/api/auth/login', [], handleLogin);
}
