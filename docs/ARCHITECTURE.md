# ARCHITECTURE.md — Flash Sale Ticket System

> Dokumen desain arsitektur (Fase 4). Turunan langsung dari `docs/PRD.md`.
> Bahasa: Indonesia (istilah teknis & identifier tetap Bahasa Inggris).
> Status: menunggu persetujuan operator (GERBANG 2).

---

## 1. Ringkasan Arsitektur

Pemisahan tegas antara **fase perebutan kuota (in-memory, Redis)** dan **fase persistensi
(disk write, PostgreSQL, asynchronous)**. Request path tidak pernah menunggu operasi tulis DB berat.

```text
[Client Browser]
      │
      ▼
[Bun.serve + Router]  ──(middleware: rate-limit, auth)──┐
      │                                                  │
      ▼                                                  │
[Bookings Controller]                                    │
      │                                                  │
      ▼                                                  │
[Bookings Service]                                       │
      │                                                  │
      ├─(1) Idempotency acquire (Redis Lua) ──► [PROCESSING] ─► 409
      │                                                  │
      ├─(2) Atomic decrement (Redis Lua) ──► [stok habis] ─► 410
      │                                                  │
      ├─(3) SET reservation:<id> EX 600                  │
      │                                                  │
      ├─(4) publish → RabbitMQ                           │
      │                                                  │
      └─(5) cache response + return 202 ─────────────────┘

[RabbitMQ]
   ├─ booking.settle ─► [Booking Worker] ─► INSERT bookings + order_items (PostgreSQL)
   └─ booking.expiry.delay ─(TTL 600s)─► booking.dlx ─► [Expiry Worker]
                                                          ├─ conditional UPDATE → EXPIRED
                                                          └─ INCRBY quota (rollback)
```

---

## 2. Kontrak Pemisahan Layer

Mengikuti `[[03-Implementation-and-Clean-Code/03-code-ordering-and-separation]]`:

```text
HTTP Request → [ROUTER] → [CONTROLLER] → [SERVICE] → [REPOSITORY] → DATABASE
```

| Layer | Boleh | Dilarang |
|---|---|---|
| **Router** | Mapping path, bind middleware (rate-limit, auth) | Logika bisnis, query DB |
| **Controller** | Parse DTO, panggil service, format HTTP status | Query SQL, aturan bisnis |
| **Service** | Orkestrasi, aturan bisnis, panggil repository + infra | Impor `req`/`res`, akses SQL mentah |
| **Repository** | Query SQL via `Bun.sql`, mapping ke entity | Tahu status HTTP |
| **Infra** | Koneksi Redis/DB/RabbitMQ, jalankan Lua | Aturan bisnis domain |

**Aturan Emas:** Service tidak tahu HTTP. Controller tidak tahu SQL.

---

## 3. Batasan & Dependensi Modul (Anti Circular Dependency)

Arah impor hanya ke bawah (satu arah):

```text
modules/*  ──►  core/*        (errors, config, http, logger)
modules/*  ──►  infra/*       (redis, db, queue)
workers/*  ──►  infra/* + modules/*/repository
core/*     ──►  (tidak mengimpor modules)
infra/*    ──►  core/config, core/errors
```

- Antar `modules/*` **dilarang** saling impor internal langsung. Komunikasi hanya via `index.ts` publik modul (Rule: No Deep-Piercing Import).
- `payments` mengubah status booking melalui `bookings` public interface (repository), bukan query lintas tabel liar.

---

## 4. Skema Database (PostgreSQL) — FINAL

```sql
CREATE TABLE users (
    id            BIGSERIAL PRIMARY KEY,
    email         VARCHAR(255) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE tickets (
    id          BIGSERIAL PRIMARY KEY,
    event_id    BIGINT NOT NULL,
    name        VARCHAR(255) NOT NULL,
    price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
    total_quota INTEGER NOT NULL CHECK (total_quota > 0),
    starts_at   TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE bookings (
    id              UUID PRIMARY KEY,
    user_id         BIGINT NOT NULL REFERENCES users(id),
    event_id        BIGINT NOT NULL,
    quantity        INTEGER NOT NULL CHECK (quantity > 0),
    status          VARCHAR(20) NOT NULL
                    CHECK (status IN ('PENDING','PAID','EXPIRED','CANCELLED')),
    idempotency_key VARCHAR(64) UNIQUE NOT NULL,
    expires_at      TIMESTAMPTZ NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_bookings_status_expires ON bookings(status, expires_at);
CREATE INDEX idx_bookings_user           ON bookings(user_id);

CREATE TABLE order_items (
    id               BIGSERIAL PRIMARY KEY,
    booking_id       UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    ticket_id        BIGINT NOT NULL REFERENCES tickets(id),
    quantity         INTEGER NOT NULL CHECK (quantity > 0),
    unit_price_cents INTEGER NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_order_items_booking ON order_items(booking_id);
```

### ADR-006: Deviasi dari skema brief — `bookings.event_id` tanpa FK ke `tickets(id)`
- **Konteks:** brief menulis `event_id BIGINT NOT NULL REFERENCES tickets(id)`. Secara semantik salah:
  `event_id` adalah identitas event, sedangkan `tickets.id` adalah identitas baris jenis tiket.
- **Keputusan:** `bookings.event_id` disimpan sebagai `BIGINT` tanpa FK; relasi tiket nyata ditegakkan
  di `order_items.ticket_id → tickets(id)`.
- **Konsekuensi:** integritas referensial tetap terjaga pada baris item; menghindari FK yang menyesatkan.

### Jaminan Anti-Overselling
Kuota otoritatif saat perebutan ada di Redis. Tepat 100 `DECRBY` sukses → tepat 100 job → tepat 100 baris
`bookings`. Database **tidak pernah** dipakai untuk validasi stok (menghindari lock contention).

---

## 5. Desain Redis (Key Space + Lua Scripts)

### 5.1 Key Space
| Key | Tipe | TTL | Fungsi |
|---|---|---|---|
| `ticket:<eventId>:quota` | String (int) | — | Kuota tersisa (sumber kebenaran saat perebutan). |
| `reservation:<bookingId>` | String (userId) | 600s | Reservasi aktif (hold pattern). |
| `idem:<idempotencyKey>` | String | 60s | Status idempotensi (`PROCESSING` atau JSON response). |
| `rl:<ip>` | Hash | 60s | Bucket token rate limiter (`tokens`, `ts`). |

### 5.2 Lua Script 1 — Atomic Stock Decrement
`src/scripts/lua/decrement_stock.lua`
```lua
-- KEYS[1]: quota key  ARGV[1]: requested quantity
-- Return: -1 key tidak ada | -2 stok kurang | >=0 sisa stok setelah potong
local stock = tonumber(redis.call('GET', KEYS[1]))
if stock == nil then return -1 end
local requested = tonumber(ARGV[1])
if stock < requested then return -2 end
return redis.call('DECRBY', KEYS[1], requested)
```

### 5.3 Lua Script 2 — Token Bucket Rate Limiter
`src/scripts/lua/token_bucket.lua`
```lua
-- KEYS[1]: bucket key  ARGV: capacity, refillPerSec, nowMs, cost
-- Return: { allowed(0|1), retryAfterMs }
local capacity = tonumber(ARGV[1])
local refill   = tonumber(ARGV[2])
local nowMs    = tonumber(ARGV[3])
local cost     = tonumber(ARGV[4])
local data = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
local tokens = tonumber(data[1]) or capacity
local ts     = tonumber(data[2]) or nowMs
local elapsed = math.max(0, nowMs - ts) / 1000.0
tokens = math.min(capacity, tokens + elapsed * refill)
if tokens < cost then
  redis.call('HMSET', KEYS[1], 'tokens', tokens, 'ts', nowMs)
  redis.call('PEXPIRE', KEYS[1], 60000)
  return { 0, math.ceil(((cost - tokens) / refill) * 1000) }
end
tokens = tokens - cost
redis.call('HMSET', KEYS[1], 'tokens', tokens, 'ts', nowMs)
redis.call('PEXPIRE', KEYS[1], 60000)
return { 1, 0 }
```

### 5.4 Lua Script 3 — Idempotency Acquire
`src/scripts/lua/idempotency_acquire.lua`
```lua
-- KEYS[1]: idem key  ARGV[1]: ttlSeconds
-- Return: { acquired(0|1), existingValue("" jika baru) }
local existing = redis.call('GET', KEYS[1])
if existing then return { 0, existing } end
redis.call('SET', KEYS[1], 'PROCESSING', 'EX', tonumber(ARGV[1]))
return { 1, '' }
```

### 5.5 Urutan Operasi Booking (Service)
1. `idempotencyAcquire(key, 60)`:
   - `existing == "PROCESSING"` → **409 REQUEST_IN_PROGRESS**
   - `existing != ""` (JSON) → **replay cached response** (keputusan operator)
   - `acquired` → lanjut
2. `decrementStock(eventId, qty)`:
   - `-1` → **410 SOLD_OUT** (kuota key belum di-seed) → hapus key idem agar bisa retry
   - `-2` → **410 SOLD_OUT** → hapus key idem
   - `>= 0` → lanjut
3. `bookingId = crypto.randomUUID()`, `expiresAt = now + 600s`
4. `SET reservation:<bookingId> <userId> EX 600`
5. Publish 2 pesan ke RabbitMQ:
   - `booking.settle` (persistensi DB)
   - `booking.expiry.delay` dengan per-message `expiration = "600000"` (rollback terjadwal)
6. `SET idem:<key> <responseJson> EX 60`
7. Return **202** `{ booking_id, status: "PENDING", expires_at, ... }`

---

## 6. Topologi RabbitMQ (Delayed Message via TTL + DLX)

```text
booking.exchange (direct, durable)
   ├─ rk "booking.settle"        ─► booking.settle         ─► [Booking Worker]
   └─ rk "booking.expiry.delay"  ─► booking.expiry.delay   ─► (TTL 600s, tanpa consumer)
                                         │ x-dead-letter-exchange = booking.dlx
                                         │ x-dead-letter-routing-key = "booking.expiry"
                                         ▼
booking.dlx (direct, durable)
   └─ rk "booking.expiry"        ─► booking.expiry         ─► [Expiry Worker]
```

| Queue | Argumen | Consumer |
|---|---|---|
| `booking.settle` | durable | Booking Worker (insert DB) |
| `booking.expiry.delay` | durable, `x-dead-letter-exchange=booking.dlx`, `x-dead-letter-routing-key=booking.expiry` | — (hanya menampung sampai TTL habis) |
| `booking.expiry` | durable | Expiry Worker (rollback + set EXPIRED) |

Pesan dipublish dengan `persistent: true` dan per-message `expiration: "600000"`.

---

## 7. Alur Worker

### 7.1 Booking Worker (`workers/booking-consumer.ts`)
```text
consume booking.settle
  → repository.createBooking(payload)  (INSERT bookings + order_items, idempotent via ON CONFLICT DO NOTHING)
  → channel.ack(msg)
  → pada error: channel.nack(msg, false, true) dengan batas retry + log terstruktur
```

### 7.2 Expiry Worker (`workers/expiry-consumer.ts`)
```text
consume booking.expiry
  → repository.expireBooking(bookingId)
      UPDATE bookings SET status='EXPIRED' WHERE id=$1 AND status='PENDING' RETURNING id
  → jika row ter-update  → INCRBY ticket:<eventId>:quota <quantity>  (rollback kuota)
  → jika tidak (sudah PAID) → skip rollback (guard anti-double-rollback)
  → channel.ack(msg)
```

### ADR-007: Guard rollback via conditional UPDATE (bukan lock aplikasi)
- **Konteks:** race antara payment callback (`PAID`) dan expiry worker (`EXPIRED`).
- **Keputusan:** status transition memakai `UPDATE ... WHERE status='PENDING' RETURNING id`.
  Hanya pemilik transisi yang berhasil (row returned) yang boleh melakukan rollback kuota.
- **Konsekuensi:** mencegah double-rollback & status overwrite tanpa distributed lock tambahan.

### 7.3 Payment Callback (transisi status)
```text
UPDATE bookings SET status='PAID' WHERE id=$1 AND status='PENDING' RETURNING *
  → row ada            → 200 { status: PAID }
  → row kosong, EXISTS → 409 BOOKING_EXPIRED
  → tidak ada          → 404 NOT_FOUND
```

---

## 8. Struktur Berkas (Feature-First, Root Tunggal Bun)

```text
FlashSaleSystem/
├── AGENTS.md
├── README.md
├── .gitignore
├── .env.example
├── docker-compose.yml
├── package.json
├── tsconfig.json
├── docs/
│   ├── RESEARCH.md
│   ├── PRD.md
│   └── ARCHITECTURE.md
├── src/
│   ├── index.ts                      # Entry: Bun.serve
│   ├── app.ts                        # Registrasi rute & middleware
│   ├── core/
│   │   ├── config/env.ts             # Baca & validasi env
│   │   ├── constants.ts              # Konstanta (TTL, limit, status)
│   │   ├── errors/app-error.ts       # AppError + subclass
│   │   ├── http/router.ts            # Router + matcher + middleware chain
│   │   ├── http/response.ts          # Helper JSON response
│   │   ├── http/validate.ts          # Validator payload (DTO)
│   │   └── logger.ts                 # Structured logging
│   ├── infra/
│   │   ├── redis/client.ts
│   │   ├── redis/scripts.ts          # Loader Lua + wrapper eval
│   │   ├── db/client.ts              # Bun.sql instance
│   │   ├── db/schema.sql             # DDL (dijalankan migrate.ts)
│   │   ├── db/migrate.ts             # Runner migrasi
│   │   ├── queue/connection.ts       # Koneksi amqplib
│   │   ├── queue/topology.ts         # Deklarasi exchange/queue/DLX
│   │   └── queue/publisher.ts        # publish helper
│   ├── middleware/
│   │   ├── auth.middleware.ts
│   │   ├── rate-limit.middleware.ts
│   │   └── error.middleware.ts
│   ├── modules/
│   │   ├── auth/
│   │   │   ├── auth.routes.ts
│   │   │   ├── auth.controller.ts
│   │   │   ├── auth.service.ts
│   │   │   ├── auth.repository.ts
│   │   │   ├── auth.schema.ts        # DTO validation
│   │   │   ├── auth.types.ts
│   │   │   ├── jwt.ts                # Sign/verify HS256
│   │   │   └── auth.spec.ts          # Co-located test
│   │   ├── events/
│   │   │   ├── events.routes.ts
│   │   │   ├── events.controller.ts
│   │   │   ├── events.service.ts
│   │   │   ├── events.repository.ts
│   │   │   └── events.types.ts
│   │   ├── bookings/
│   │   │   ├── bookings.routes.ts
│   │   │   ├── bookings.controller.ts
│   │   │   ├── bookings.service.ts
│   │   │   ├── bookings.repository.ts
│   │   │   ├── stock.service.ts      # Wrapper Lua decrement + rollback
│   │   │   ├── idempotency.service.ts
│   │   │   ├── bookings.schema.ts
│   │   │   ├── bookings.types.ts
│   │   │   └── bookings.spec.ts
│   │   └── payments/
│   │       ├── payments.routes.ts
│   │       ├── payments.controller.ts
│   │       └── payments.service.ts
│   ├── scripts/
│   │   ├── lua/
│   │   │   ├── decrement_stock.lua
│   │   │   ├── token_bucket.lua
│   │   │   └── idempotency_acquire.lua
│   │   └── seed.ts                   # Seed event + kuota Redis
│   └── workers/
│       ├── index.ts                  # Jalankan semua consumer
│       ├── booking-consumer.ts
│       └── expiry-consumer.ts
├── public/
│   ├── index.html                    # Landing + auth
│   ├── event.html                    # Detail + beli
│   ├── booking.html                  # Status pesanan
│   ├── styles.css                    # Design token (CSS vars)
│   └── app.js                        # Vanilla JS (fetch + polling)
└── loadtest/
    ├── booking.js                    # k6 script (2000 VU)
    └── results/                      # Output JSON k6
```

**Batas keras dipatuhi:** file ≤ 300 baris, fungsi ≤ 30 baris, parameter ≤ 3, nesting ≤ 2.

---

## 9. Konfigurasi Environment (`.env.example`)

```dotenv
PORT=3000
DATABASE_URL=postgres://flashsale:flashsale@localhost:5432/flashsale
REDIS_URL=redis://localhost:6379
RABBITMQ_URL=amqp://guest:guest@localhost:5672
JWT_SECRET=change-me-in-real-env
JWT_EXPIRES_IN=3600
RESERVATION_TTL_SECONDS=600
IDEMPOTENCY_TTL_SECONDS=60
RATE_LIMIT_CAPACITY=10
RATE_LIMIT_REFILL_PER_SEC=10
```

> `JWT_SECRET` di produksi wajib nilai acak kuat; `.env` asli tidak pernah masuk git.

---

## 10. Docker Compose (Infrastruktur)

| Service | Image | Port | Catatan |
|---|---|---|---|
| `redis` | `redis:7.4-alpine` | 6379 | ≥ 7.2 (syarat klien Redis Bun). |
| `postgres` | `postgres:16-alpine` | 5432 | User/db `flashsale`. |
| `rabbitmq` | `rabbitmq:3.13-management-alpine` | 5672, 15672 | Management UI untuk inspeksi. |

Volume persisten untuk Postgres & RabbitMQ. Healthcheck per service.

---

## 11. Dekomposisi Tugas (Sub-Tugas Eksekusi)

Urutan eksekusi (1 sub-tugas = 1 commit atomik). Tanda ✅ = verifikasi Tier-1, 🔬 = Tier-2 (butuh Docker).

### Blok A — Fondasi
- **A1.** `package.json`, `tsconfig.json`, `.env.example`, `docker-compose.yml`, `README.md` skeleton.
- **A2.** `src/core/config/env.ts` + `src/core/constants.ts` — pembacaan & validasi env.
- **A3.** `src/core/errors/app-error.ts` — AppError + NotFound/Validation/Conflict/Gone/Unauthorized/RateLimited.
- **A4.** `src/core/logger.ts` — logging terstruktur (JSON).

### Blok B — Infrastruktur
- **B1.** `src/infra/redis/client.ts` + `src/infra/redis/scripts.ts` + 3 file `src/scripts/lua/*.lua`.
- **B2.** `src/infra/db/client.ts` (`Bun.sql`) + `src/infra/db/schema.sql` + `src/infra/db/migrate.ts`. 🔬
- **B3.** `src/infra/queue/connection.ts` + `topology.ts` + `publisher.ts` (amqplib). 🔬

### Blok C — Kernel HTTP
- **C1.** `src/core/http/router.ts` — router + middleware chain + param matching.
- **C2.** `src/core/http/response.ts` + `src/core/http/validate.ts` (DTO validator).
- **C3.** `src/middleware/error.middleware.ts` + `rate-limit.middleware.ts` + `auth.middleware.ts`.
- **C4.** `src/app.ts` + `src/index.ts` — wiring `Bun.serve`. ✅

### Blok D — Modul Auth
- **D1.** `auth.types.ts` + `auth.schema.ts` + `jwt.ts` (HS256 via WebCrypto).
- **D2.** `auth.repository.ts` + `auth.service.ts` (`Bun.password` argon2id).
- **D3.** `auth.controller.ts` + `auth.routes.ts`.
- **D4.** `auth.spec.ts` — unit test hashing/JWT/validasi. ✅

### Blok E — Modul Events
- **E1.** `events.types.ts` + `events.repository.ts`.
- **E2.** `events.service.ts` + `events.controller.ts` + `events.routes.ts` (quota dari Redis).

### Blok F — Modul Bookings (inti)
- **F1.** `bookings.types.ts` + `bookings.schema.ts`.
- **F2.** `stock.service.ts` — decrement + rollback via Lua.
- **F3.** `idempotency.service.ts` — acquire/complete/replay.
- **F4.** `bookings.repository.ts` — insert booking + order_items, conditional status update.
- **F5.** `bookings.service.ts` — orkestrasi alur §5.5.
- **F6.** `bookings.controller.ts` + `bookings.routes.ts`.
- **F7.** `bookings.spec.ts` — unit test logika status & idempotency. ✅

### Blok G — Modul Payments
- **G1.** `payments.service.ts` + `payments.controller.ts` + `payments.routes.ts` (mock callback).

### Blok H — Workers
- **H1.** `workers/booking-consumer.ts` — persist DB.
- **H2.** `workers/expiry-consumer.ts` — rollback + EXPIRED.
- **H3.** `workers/index.ts` — jalankan kedua consumer. 🔬

### Blok I — Frontend
- **I1.** `public/styles.css` — design token (§6.3 PRD).
- **I2.** `public/index.html` + `app.js` bagian auth.
- **I3.** `public/event.html` — kuota live + beli.
- **I4.** `public/booking.html` — status + polling + simulasi bayar.

### Blok J — Data & Uji Beban
- **J1.** `src/scripts/seed.ts` — seed event + set kuota Redis 100. 🔬
- **J2.** `loadtest/booking.js` — k6 2000 VU. 🔬
- **J3.** Verifikasi integritas pasca-load-test (script cek: count DB = 100, quota Redis = 0). 🔬

### Blok K — Penutup
- **K1.** `README.md` final (diagram, cara jalan, hasil load test, analisis bottleneck).
- **K2.** Sinkronisasi `docs/` & commit akhir.

---

## 12. Dependensi

| Dependency | Versi | Alasan | Status |
|---|---|---|---|
| `amqplib` | ^0.10.7 | Client AMQP (RabbitMQ). Tidak ada alternatif native di Bun. | ✅ Disetujui operator |
| `bun-types` (dev) | 1.4.2 | Type definitions Bun. | ✅ (bundled runtime) |

Seluruh kebutuhan lain native Bun: HTTP (`Bun.serve`), Redis (`Bun.redis`), PostgreSQL (`Bun.sql`),
password (`Bun.password`), crypto/JWT (WebCrypto), test runner (`bun test`).

---

## 13. Verifikasi Dua Tingkat

- **Tier 1:** `bun test` (unit in-memory) + `bunx tsc --noEmit` (typecheck).
- **Tier 2 (butuh Docker):** `docker compose up -d` → `bun run migrate` → `bun run seed` →
  start worker → jalankan k6 → cek integritas (count DB = 100, quota Redis = 0, p95 < 150ms).

---

## 14. Risiko Arsitektur

| # | Risiko | Mitigasi |
|---|---|---|
| A1 | Pesan RabbitMQ hilang saat restart (classic queue + TTL) | Queue durable + pesan persistent; dokumentasi trade-off; opsi periodic sweeper. |
| A2 | Redis crash setelah kuota terpotong | Reservasi ber-TTL; dokumentasi CAP trade-off. |
| A3 | Race PAID vs EXPIRED | Guard conditional UPDATE (§ADR-007). |
| A4 | amqplib tidak kompatibel penuh di Bun | Smoke test Tier-2; fallback: jalankan worker di Node v24 (tersedia). |
