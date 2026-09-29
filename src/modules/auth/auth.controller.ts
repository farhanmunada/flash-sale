/** Auth HTTP layer: parse request, call service, format response. */

import { HTTP_STATUS } from '../../core/constants.ts';
import { json } from '../../core/http/response.ts';
import { parseBody } from '../../core/http/validate.ts';
import { loginSchema, registerSchema } from './auth.schema.ts';
import * as service from './auth.service.ts';
import type { RequestContext } from '../../core/http/router.ts';

export async function handleRegister(ctx: RequestContext): Promise<Response> {
  const input = await parseBody(ctx.request, registerSchema);
  const user = await service.register(input);
  return json(user, HTTP_STATUS.CREATED);
}

export async function handleLogin(ctx: RequestContext): Promise<Response> {
  const input = await parseBody(ctx.request, loginSchema);
  const result = await service.login(input);
  return json(result, HTTP_STATUS.OK);
}
