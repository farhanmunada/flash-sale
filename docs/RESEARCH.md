# RESEARCH.md — Flash Sale Ticket System

> Dokumen riset (Fase 2). Basis fakta untuk penyusunan `docs/PRD.md`.
> Tanggal riset: sesi inisiasi projek. Penulis: AI Agent.
> Semua temuan di bawah diverifikasi dari environment lokal dan dokumentasi resmi.

---

## 1. Ringkasan Eksekutif

Projek ini membangun **sistem flash sale tiket** yang tahan terhadap dua masalah klasik
pada beban tinggi: **overselling (race condition)** dan **database bottleneck/deadlock**.
Pendekatan inti: memisahkan **fase perebutan kuota (in-memory, Redis)** dari
**fase persistensi (disk write, PostgreSQL, asynchronous via RabbitMQ)**.

Temuan kunci riset: **Bun 1.4.2 menyediakan hampir seluruh kebutuhan primitif secara native**
(HTTP server, Redis client + Lua `eval`, PostgreSQL client dengan pooling, password hashing).
Akibatnya, projek ini hanya membutuhkan **satu dependency eksternal**: `amqplib` (client RabbitMQ).

---

## 2. Deteksi Environment (Fakta Terverifikasi)

| Komponen | Status | Versi / Catatan |
|---|---|---|
| OS | ✅ Terdeteksi | `win32` (Windows). Shell: **PowerShell** — dilarang chaining `&&`, dilarang utilitas POSIX (`grep`/`cat`/`export`). |
| Bun | ✅ Terpasang | **v1.4.2** — runtime utama. |
| Node.js | ✅ Terpasang | v24.13.0 (tersedia sebagai fallback bila diperlukan). |
| Git | ✅ Terpasang | v2.47.1.windows.1. Repo sudah di-`git init` dengan branch `main`. |
| Docker | ❌ **Belum terpasang** | `docker` tidak dikenali. **Blocker untuk Fase Verifikasi Tier-2.** Operator akan memasang Docker Desktop. |
| k6 | ❌ **Belum terpasang** | Diperlukan untuk load test 2.000 VU. Operator akan memasang k6. |

**Status repositori awal:** hanya berisi `AGENTS.md`. Belum ada `docs/`, `.gitignore`, atau `package.json`.
Aksi bootstrap yang sudah dilakukan: `git init`, branch `main`, `.gitignore` (proteksi `.env`, `node_modules/`, `dist/`).

---

## 3. Kapabilitas Native Bun 1.4.2 (Terverifikasi)

Riset dokumentasi resmi (`bun.com/docs`) dan verifikasi tipe lokal (`bun-types@1.4.2`):

### 3.1 HTTP Server — `Bun.serve`
- Server HTTP bawaan runtime, tanpa dependency (`express`/`fastify` tidak diperlukan).
- Mendukung routing `routes`, HTML imports, dan handler `fetch`.

### 3.2 Redis Client — `Bun.redis` / `RedisClient`
- Client Redis native (implementasi Rust, protokol RESP3), Promise-based.
- **Lua scripting didukung** sejak PR oven-sh/bun#29339 (merged Agu 2026).
- **Signature terverifikasi dari `bun-types@1.4.2`:**
  ```ts
  eval(script: string, numkeys: number, ...keysAndArgs: (string | number)[]): Promise<any>;
  evalsha(sha1: string, numkeys: number, ...keysAndArgs: (string | number)[]): Promise<any>;
  decrby(key, decrement): Promise<number>;
  incrby(key, increment): Promise<number>;
  ```
- **Implikasi:** primitive inti (atomic decrement via Lua) dapat dijalankan **tanpa `ioredis`**.
- **Catatan versi:** klien Redis Bun mensyaratkan **Redis server ≥ 7.2**.
- **Keterbatasan yang diketahui:** belum mendukung Redis Cluster/Sentinel (tidak dibutuhkan untuk projek single-node).

### 3.3 PostgreSQL Client — `Bun.sql`
- Client SQL native (tagged template literal) dengan **connection pooling**, **prepared statements**
  (anti SQL-injection by design), dan transaksi.
- Dibaca otomatis dari environment variable (mis. `DATABASE_URL`).
- **Implikasi:** layer DB dapat dibangun **tanpa `pg` / `postgres.js` / ORM**.

### 3.4 Password Hashing — `Bun.password`
- `Bun.password.hash()` (default **argon2id**) dan `Bun.password.verify()`, native.
- **Implikasi:** autentikasi dapat dibangun **tanpa `bcrypt` / `argon2`**.
- Rekomendasi parameter argon2id (OWASP): memory ≥ 19 MiB, iterations ≥ 2, parallelism 1.

### 3.5 Kriptografi & UUID
- `crypto.randomUUID()` dan WebCrypto (`crypto.subtle`) tersedia native untuk
  **JWT (HS256)** dan generasi `booking_id` (UUID v4).

---

## 4. Keputusan Teknologi (ADR Ringkas)

### ADR-001: Runtime Bun + TypeScript
- **Konteks:** Butuh runtime cepat untuk I/O-bound concurrency, tipe statis, toolchain minimal.
- **Keputusan:** Bun 1.4.2 + TypeScript. `Bun.serve` sebagai HTTP server, `bun test` sebagai test runner.
- **Konsekuensi:** toolchain minimal (bundler + test runner + runtime jadi satu). Risiko: ekosistem
  lebih muda dari Node, namun kebutuhan projek tertutup oleh fitur native.

### ADR-002: Redis sebagai kuota in-memory + Lua atomic
- **Konteks:** `SELECT stock` lalu `UPDATE stock` memicu race condition; `SELECT ... FOR UPDATE`
  memicu lock contention & pool exhaustion.
- **Keputusan:** kuota disimpan di Redis; decrement dilakukan sebagai **satu script Lua atomik**
  via `Bun.redis.eval()`. Database tidak disentuh sampai kuota berhasil diamankan.
- **Konsekuensi:** latency fase perebutan turun ke level memori (target p95 < 150ms);
  sumber kebenaran kuota sementara ada di Redis (perlu rollback saat reservasi kedaluwarsa).

### ADR-003: RabbitMQ sebagai message broker
- **Konteks:** persistensi DB harus di-decouple dari request path. Diagram kebutuhan menyebut RabbitMQ/Kafka.
- **Keputusan:** **RabbitMQ** (model queue + ack sederhana; 1 job = 1 order). Mendukung
  **per-message TTL + Dead Letter Exchange (DLX)** yang dibutuhkan untuk pola reservasi kedaluwarsa.
- **Konsekuensi:** butuh satu dependency eksternal (`amqplib`) dan satu container tambahan.
- **Alternatif ditolak:** Kafka (operasional berat, overkill untuk 2.000 VU); Redis Streams (kurang
  representatif untuk portofolio).

### ADR-004: Dependency tunggal — `amqplib`
- **Konteks:** AGENTS.md §1.3 melarang penambahan package tanpa konfirmasi manusia. Semua kebutuhan
  lain sudah native Bun.
- **Keputusan:** menambahkan **`amqplib`** saja (v2.x, 0 dependency, TypeScript types bawaan,
  kompatibel RabbitMQ 4.1+). **Disetujui operator.**
- **Konsekuensi:** footprint dependency projek = 1 paket produksi.

### ADR-005: Infrastruktur via Docker Compose
- **Konteks:** Redis, PostgreSQL, dan RabbitMQ harus berjalan untuk development & verifikasi Tier-2.
- **Keputusan:** `docker-compose.yml` tunggal menyalakan ketiga service. Operator memasang Docker Desktop.
- **Konsekuensi:** environment reproducible dengan satu perintah; prasyarat eksternal (Docker Desktop).

---

## 5. Pola Teknis Referensi (dari dokumentasi resmi)

### 5.1 Redis Lua — pola atomic read-modify-write
Pola resmi Redis untuk mencegah race condition: operasi baca-cek-tulis dijalankan sebagai satu
unit di dalam Lua (single-threaded, atomik di server Redis):
```lua
local val = tonumber(redis.call('GET', KEYS[1]))
if val and val >= tonumber(ARGV[1]) then
  redis.call('DECRBY', KEYS[1], ARGV[1])
  return 1
end
return 0
```

### 5.2 Idempotency — pola lock/set-NX
`SET key value NX EX ttl` untuk mengunci pemrosesan idempoten; response tersimpan di-replay
untuk request duplikat (keputusan operator: **replay cached response**).

### 5.3 RabbitMQ — pola delayed message via TTL + DLX
Dokumentasi resmi RabbitMQ (`/docs/dlx`, `/docs/ttl`): sebuah queue dapat dideklarasikan dengan
`x-message-ttl` / per-message `expiration`, dan `x-dead-letter-exchange`. Saat TTL pesan habis,
pesan otomatis di-route ke DLX → DLQ → consumer rollback. Ini adalah cara standar membuat
"delayed message" tanpa plugin `rabbitmq_delayed_message_exchange`.

---

## 6. Risiko & Mitigasi

| # | Risiko | Dampak | Mitigasi |
|---|---|---|---|
| R1 | Docker Desktop belum terpasang | Verifikasi Tier-2 terblokir | Operator memasang Docker Desktop sebelum Fase 6. |
| R2 | k6 belum terpasang | Load test tidak bisa dijalankan | Operator memasang k6 (winget/choco) sebelum Fase 6. |
| R3 | Redis crash setelah kuota terpotong | Potensi kuota "hilang" (stok tidak konsisten dengan DB) | Reservasi disimpan dengan TTL; reconciliation job opsional; dokumentasi trade-off. |
| R4 | Pesan RabbitMQ hilang saat restart (classic queue, TTL) | Reservasi tidak di-rollback | Queue `durable` + pesan `persistent`; opsi quorum queue; tambahan periodic sweeper opsional sebagai jaring pengaman. |
| R5 | Klien Redis Bun butuh Redis ≥ 7.2 | Gagal koneksi pada Redis lama | Pin image Redis ≥ 7.2 (mis. `redis:7.4-alpine`) di compose. |
| R6 | `amqplib` di runtime Bun | Ketidakcocokan API Node | Bun kompatibel dengan sebagian besar paket Node; verifikasi smoke test di Tier-2. |

---

## 7. Sumber Referensi Resmi

1. Bun Docs — Redis client: https://bun.com/docs/runtime/redis
2. Bun Docs — SQL (PostgreSQL): https://bun.com/docs/runtime/sql
3. Bun Docs — Password hashing: https://bun.com/reference/bun/password
4. Bun Docs — Node.js compatibility: https://bun.com/docs/runtime/nodejs-compat
5. oven-sh/bun PR #29339 (Redis scripting `eval`): https://github.com/oven-sh/bun/pull/29339
6. Redis Docs — Scripting with Lua (`EVAL`): https://redis.io/docs/latest/develop/programmability/eval-intro
7. RabbitMQ Docs — Dead Letter Exchanges: https://www.rabbitmq.com/docs/dlx
8. RabbitMQ Docs — Time-To-Live and Expiration: https://www.rabbitmq.com/docs/ttl
9. amqplib (npm): https://www.npmjs.com/package/amqplib

---

## 8. Kesimpulan Riset

1. Stack final: **Bun 1.4.2 + TypeScript**, `Bun.serve`, `Bun.redis` (+Lua `eval`), `Bun.sql`,
   `Bun.password`, RabbitMQ via **`amqplib`**, PostgreSQL & Redis via **Docker Compose**.
2. Primitive anti-race-condition (atomic decrement) **terverifikasi tersedia** di runtime.
3. Dua prasyarat eksternal masih tertunda: **Docker Desktop** dan **k6** (di luar scope kode).
4. Riset ini menjadi dasar penulisan `docs/PRD.md`.
