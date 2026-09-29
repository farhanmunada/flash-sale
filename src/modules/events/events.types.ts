/** Events module types and DTOs. */

export interface TicketRow {
  readonly id: number;
  readonly event_id: number;
  readonly name: string;
  readonly price_cents: number;
  readonly total_quota: number;
  readonly starts_at: string | null;
}

export interface EventSummary {
  readonly event_id: number;
  readonly name: string;
  readonly price_cents: number;
  readonly starts_at: string | null;
}

export interface QuotaResponse {
  readonly event_id: number;
  readonly remaining: number;
}
