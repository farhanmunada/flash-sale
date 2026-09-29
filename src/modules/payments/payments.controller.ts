/** Payments HTTP layer (mock payment gateway callback). */

import { HTTP_STATUS } from '../../core/constants.ts';
import { ValidationError } from '../../core/errors/app-error.ts';
import { json } from '../../core/http/response.ts';
import { parseBody } from '../../core/http/validate.ts';
import * as service from './payments.service.ts';
import type { RequestContext } from '../../core/http/router.ts';
import type { Schema } from '../../core/http/validate.ts';

const callbackSchema = {
  booking_id: { type: 'uuid' },
  status: { type: 'string', min: 1, max: 20 },
} satisfies Schema;

export async function handleCallback(ctx: RequestContext): Promise<Response> {
  const input = await parseBody(ctx.request, callbackSchema);
  if (input.status !== 'PAID') {
    throw new ValidationError('Status pembayaran harus "PAID"', { field: 'status' });
  }

  const result = await service.confirmPayment(input.booking_id);
  return json(result, HTTP_STATUS.OK);
}
