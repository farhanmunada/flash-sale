/**
 * k6 load test: 2000 virtual users race for 100 tickets.
 *
 * Usage:
 *   1. bun run seed 1 100          # reset event 1 to 100 tickets
 *   2. bun run start               # start API server
 *   3. bun run worker              # start workers (persist + expiry)
 *   4. k6 run loadtest/booking.js
 *
 * Env overrides:
 *   BASE_URL   (default http://localhost:3000)
 *   EVENT_ID   (default 1)
 *   VUS        (default 2000)
 */

import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';
import { SharedArray } from 'k6/data';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const EVENT_ID = Number(__ENV.EVENT_ID || 1);
const VUS = Number(__ENV.VUS || 2000);

// Tokens are pre-provisioned before the run and read from a file (one per line).
const tokens = new SharedArray('tokens', () => {
  const raw = open('./loadtest/tokens.txt');
  return raw.split('\n').map((line) => line.trim()).filter((line) => line.length > 0);
});

const accepted = new Counter('booking_accepted');
const soldOut = new Counter('booking_sold_out');
const rateLimited = new Counter('booking_rate_limited');
const otherErrors = new Counter('booking_other_errors');

export const options = {
  scenarios: {
    flash_sale: {
      executor: 'per-vu-iterations',
      vus: VUS,
      iterations: 1,
      maxDuration: '60s',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<150', 'p(99)<300'],
    http_req_failed: ['rate<0.01'],
  },
};

export default function () {
  const token = tokens[__VU % tokens.length];
  const payload = JSON.stringify({ event_id: EVENT_ID, quantity: 1 });

  const response = http.post(`${BASE_URL}/api/bookings`, payload, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'Idempotency-Key': `${__VU}-${__ITER}-${Date.now()}`,
    },
  });

  if (response.status === 202) accepted.add(1);
  else if (response.status === 410) soldOut.add(1);
  else if (response.status === 429) rateLimited.add(1);
  else otherErrors.add(1);

  check(response, {
    'status is expected': (r) => [202, 410, 429].includes(r.status),
  });
}
