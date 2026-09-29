# Flash Sale Ticket System

Sistem penjualan tiket flash sale yang tahan terhadap **overselling (race condition)** dan
**database bottleneck/deadlock** pada beban ekstrem — misalnya 2.000–50.000 pengguna berebut
100 tiket dalam hitungan detik.

Pendekatan inti: **memisahkan fase perebutan kuota (in-memory, Redis)** dari
**fase persistensi (disk write, PostgreSQL, asynchronous via RabbitMQ)**.

---

## Arsitektur

```text
[Client]
   │
   ▼
[Bun.serve + Router]  ──(rate limit: Redis token bucket, auth: JWT)──┐
   │                                                                 │
   ▼                                                                 │
[Booking Service]                                                    │
   ├─(1) Idempotency acquire (Redis Lua) ──► PROCESSING ──► HTTP 409  │
   ├─(2) Atomic stock decrement (Redis Lua) ──► stok habis ──► HTTP 410
   ├─(3) SET reservation:<id> EX 600                                  │
   ├─(4) publish → RabbitMQ (settle + expiry-delay)                   │
   └─(5) cache response ──► HTTP 202 { booking_id, status: PENDING } ─┘

[RabbitMQ]
   ├─ booking.settle ────────► [Booking Worker] ─► INSERT bookings + order_items
   └─ booking.expiry.delay ──(TTL 600s)──► booking.dlx ──► [Expiry Worker]
                                                            ├─ PENDING → EXPIRED
                                                            └─ INCRBY quota (rollback)
```

Detail lengkap: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) · Kebutuhan: [`docs/PRD.md`](docs/PRD.md) · Riset: [`docs/RESEARCH.md`](docs/RESEARCH.md).

---

## Kenapa ini bekerja

| Masalah klasik | Solusi di sini |
|---|---|
| **Overselling** — banyak transaksi baca stok `1` bersamaan, semua lolos | Decrement + cek stok dijalankan sebagai **satu Lua script atomik** di Redis (`EVAL`). Tidak ada jeda network antara GET dan DECR. |
| **DB bottleneck / pool exhausted** — `SELECT ... FOR UPDATE` mengantre di disk I/O | Request path **tidak menyentuh database**. Persistensi didelegasikan ke worker via queue. Database hanya menulis, tidak pernah jadi tempat validasi stok. |
| **Double-submit** — user menekan tombol berkali-kali | **Idempotency-Key** wajib. Request duplikat mengembalikan response tersimpan (replay), bukan pesanan baru. |
| **Tiket hangus** — tiket diamankan tapi tidak dibayar | **Hold pattern**: reservasi ber-TTL 600s. RabbitMQ per-message TTL + DLX memicu rollback kuota otomatis. |

---

## Stack Teknologi

- **Runtime:** Bun 1.4.2 + TypeScript (strict)
- **HTTP:** `Bun.serve` (native)
- **Redis:** `Bun.redis` native (RESP3) + Lua scripting — **Redis ≥ 7.2**
- **PostgreSQL:** `Bun.sql` native (pooling + prepared statements) — **PostgreSQL ≥ 15**
- **Password:** `Bun.password` (argon2id) native
- **JWT:** HS256 via WebCrypto (native)
- **Message Broker:** RabbitMQ via `amqplib` — **satu-satunya dependency eksternal**
- **Infrastruktur:** Docker Compose
- **Uji beban:** k6

> Keputusan teknologi (ADR) terdokumentasi di [`docs/RESEARCH.md`](docs/RESEARCH.md).

---

## Prasyarat

| Tool | Versi | Catatan |
|---|---|---|
| Bun | ≥ 1.4 | https://bun.sh |
| Docker Desktop | terbaru | Butuh **WSL2** aktif di Windows |
| k6 | ≥ 0.50 | https://grafana.com/docs/k6 |

---

## Cara Menjalankan

```powershell
# 1. Install dependency
bun install

# 2. Siapkan environment
Copy-Item .env.example .env      # lalu sesuaikan JWT_SECRET

# 3. Nyalakan infrastruktur (Redis, PostgreSQL, RabbitMQ)
docker compose up -d

# 4. Migrasi skema database
bun run migrate

# 5. Seed event + kuota 100 tiket (event_id = 1)
bun run seed 1 100

# 6. Jalankan API server
bun run start

# 7. (terminal terpisah) Jalankan workers
bun run worker
```

Buka `http://localhost:3000` untuk UI.

---

## Endpoint API

| Method | Path | Auth | Deskripsi |
|---|---|---|---|
| POST | `/api/auth/register` | — | Registrasi pengguna |
| POST | `/api/auth/login` | — | Login (JWT) |
| GET | `/api/events/:eventId/quota` | — | Sisa kuota real-time |
| POST | `/api/bookings` | ✅ | Checkout (butuh `Idempotency-Key`) |
| GET | `/api/bookings/:bookingId` | ✅ | Status booking |
| POST | `/api/payments/callback` | — | Simulasi webhook pembayaran |
| GET | `/health` | — | Health check |

Kontrak lengkap: [`docs/PRD.md`](docs/PRD.md) §7.

---

## Uji Beban (k6)

```powershell
# Provision 2000 user + token (server harus jalan)
bun run provision-tokens 2000

# Reset kuota ke 100 tiket
bun run seed 1 100

# Jalankan load test: 2000 VU berebut 100 tiket
k6 run loadtest/booking.js

# Verifikasi integritas: tepat 100 booking, kuota Redis = 0
bun run verify-integrity 1 100
```

> **Catatan:** untuk menguji murni perilaku kuota, naikkan rate limiter agar tidak ikut
> membatasi (semua VU berasal dari IP yang sama):
> `$env:RATE_LIMIT_CAPACITY="1000000"; $env:RATE_LIMIT_REFILL_PER_SEC="1000000"` sebelum
> `bun run start`. Uji rate limiter sendiri dilakukan terpisah (lihat `docs/PRD.md`).

Target (acceptance criteria): **p95 < 150ms**, **p99 < 300ms**, error rate < 1%,
**nol overselling** (tepat 100 booking).

### Hasil verifikasi nyata

Dijalankan di mesin dev tunggal (k6 + server Bun + Redis/PostgreSQL/RabbitMQ dalam Docker
berjalan di host yang sama). Setiap run: `bun run seed 1 100` lalu
`k6 run loadtest/booking.js` dengan `VUS` bervariasi.

| VUs | Throughput | p95 | Error aplikasi | Tiket terjual | Overselling |
|----:|-----------:|----:|---------------:|--------------:|:-----------:|
| 100 | ~640 req/s | **90 ms** | **0.00%** | **100** | **0** |
| 500 | ~630 req/s | 167 ms | **0.00%** | **100** | **0** |
| 1000 | ~722 req/s | 526 ms | **0.00%** | **100** | **0** |
| 2000 | ~600 req/s | ~2.5 s | **0.00%** | **100** | **0** |

**Kesimpulan:**
- **Nol overselling di semua level** — selalu tepat 100 booking, kuota Redis berakhir `0`
  (`bun run verify-integrity 1 100` → `ok: true`). Ini properti inti sistem.
- **Error aplikasi 0%** di seluruh run. Metrik `booking_app_error_rate` hanya menghitung respons
  server yang tak terduga (5xx/4xx selain 410/429). Kegagalan yang muncul pada 2000 VU
  (`booking_connection_errors`) adalah **penolakan koneksi TCP** (`status 0`,
  `connectex: No connection could be made`) — backlog listen socket OS saat 2000 koneksi baru
  menyerbu serentak dari satu host, bukan kegagalan logika aplikasi.
- **Target p95 < 150ms terpenuhi hingga ~100–500 VU** (~640 req/s), batas wajar satu proses Bun
  pada satu mesin dev.
- Pada 1000–2000 VU latensi naik karena **kejenuhan satu host** (k6, server Bun, dan ketiga
  container berbagi CPU/memori). Redis terukur ~26.000 ops/s (≈1 ms/op), jadi kuota bukan
  bottleneck. Di deployment nyata, server dan load generator berada di mesin terpisah.

Verifikasi integritas pasca-run:

```text
Integrity check { bookingCount: 100, expected: 100, remaining: 0, ok: true }
```

Status booking di PostgreSQL: `PENDING = 100`, `order_items = 100`, idempotency key unik = 100.

---

## Verifikasi

```powershell
bun run typecheck     # Tier 1: tsc --noEmit
bun test              # Tier 1: unit tests
```

Tier 2 (butuh Docker + k6): `docker compose up -d` → `bun run migrate` → `bun run seed`
→ jalankan server + worker → k6 → `bun run verify-integrity`.

---

## Struktur Proyek

```text
src/
├── core/           # config, constants, errors, logger, http kernel (router/validate/response)
├── infra/          # redis, db, queue (RabbitMQ)
├── middleware/     # auth, rate-limit, error
├── modules/        # feature-first: auth, events, bookings, payments, health
├── scripts/        # lua/, seed, migrate runner, provision-tokens, verify-integrity
└── workers/        # booking-consumer, expiry-consumer
public/             # UI (HTML + CSS + vanilla JS)
loadtest/           # k6 script
docs/               # RESEARCH, PRD, ARCHITECTURE
```

---

## Batasan (Non-Goals)

Integrasi payment gateway nyata, Redis Cluster/sharding, refund/reschedule, admin panel,
OAuth/2FA, dan notifikasi email/SMS **di luar cakupan** iterasi ini. Lihat
[`docs/PRD.md`](docs/PRD.md) §2.2.
