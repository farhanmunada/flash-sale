/** Events business logic: expose live quota from Redis. */

import { redisKeys } from '../../core/constants.ts';
import { NotFoundError } from '../../core/errors/app-error.ts';
import { readStock } from '../../infra/redis/scripts.ts';
import * as repository from './events.repository.ts';
import type { EventSummary, QuotaResponse } from './events.types.ts';

export async function getQuota(eventId: number): Promise<QuotaResponse> {
  const ticket = await repository.findTicketByEventId(eventId);
  if (!ticket) throw new NotFoundError('Event tidak ditemukan');

  const remaining = await readStock(redisKeys.quota(eventId));
  return { event_id: eventId, remaining: remaining < 0 ? ticket.total_quota : remaining };
}

export async function getEvent(eventId: number): Promise<EventSummary> {
  const ticket = await repository.findTicketByEventId(eventId);
  if (!ticket) throw new NotFoundError('Event tidak ditemukan');
  return {
    event_id: ticket.event_id,
    name: ticket.name,
    price_cents: ticket.price_cents,
    starts_at: ticket.starts_at,
  };
}
