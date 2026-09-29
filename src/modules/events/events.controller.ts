/** Events HTTP layer. */

import { HTTP_STATUS } from '../../core/constants.ts';
import { json } from '../../core/http/response.ts';
import { ValidationError } from '../../core/errors/app-error.ts';
import * as service from './events.service.ts';
import type { RequestContext } from '../../core/http/router.ts';

function parseEventId(ctx: RequestContext): number {
  const raw = ctx.params.eventId;
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw new ValidationError('eventId harus berupa angka positif', { field: 'eventId' });
  }
  return id;
}

export async function handleGetQuota(ctx: RequestContext): Promise<Response> {
  const result = await service.getQuota(parseEventId(ctx));
  return json(result, HTTP_STATUS.OK);
}

export async function handleGetEvent(ctx: RequestContext): Promise<Response> {
  const result = await service.getEvent(parseEventId(ctx));
  return json(result, HTTP_STATUS.OK);
}
