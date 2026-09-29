# Product Requirements Document (PRD): Flash Sale Ticket System

> **Status:** DRAFT — menunggu persetujuan operator (GERBANG 1).
> **Versi:** 1.0
> **Bahasa:** Indonesia (istilah teknis & identifier kode tetap Bahasa Inggris).
> **Dokumen terkait:** `docs/RESEARCH.md` (basis fakta).

---

## 1. Problem Statement

### 1.1 Latar Belakang
Sistem penjualan tiket flash sale menghadapi lonjakan trafik ekstrem dalam jendela waktu
sangat singkat (contoh: **50.000 pengguna** menekan "Beli" dalam **2 detik** untuk **100 tiket**).
Pendekatan naif — `SELECT stock FROM tickets` lalu `UPDATE tickets SET stock = stock - 1` —
gagal pada dua titik:

1. **Overselling (Race Condition):** beberapa transaksi membaca sisa stok yang sama (`1`) secara
   bersamaan, semuanya lolos validasi, dan tiket terjual melebihi kuota (stok negatif).
2. **Database Bottleneck / Deadlock:** penggunaan row-level locking (`SELECT ... FOR UPDATE`)
   membuat transaksi mengantre pada disk I/O, menghabiskan connection pool, dan memicu
   HTTP 504 Gateway Timeout.

### 1.2 Siapa yang Terdampak
- **Penyelenggara event:** rugi finansial & reputasi akibat overselling (tiket yang tidak ada),
  atau kehilangan penjualan akibat sistem tumbang saat momen paling menguntungkan.
- **Pembeli tiket:** pengalaman buruk — timeout, pembayaran gagal, atau tiket yang "dimenangkan"
  lalu dibatalkan sepihak.
- **Tim engineering:** insiden produksi berulang, sulit di-reproduksi, dan mahal diperbaiki setelah kejadian.

### 1.3 Dampak Jika Tidak Diselesaikan
Sistem tidak dapat dipercaya pada momen bernilai tinggi. Setiap flash sale berpotensi menjadi
insiden publik (overselling) atau kehilangan seluruh potensi revenue (downtime).

---

## 2. Target Goals & Non-Goals

### 2.1 Goals (In-Scope)
- **G1 — Bebas Overselling:** jumlah booking sukses **tepat sama** dengan kuota, tidak pernah lebih,
  pada beban 2.000 concurrent user untuk 100 tiket.
- **G2 — Latency rendah pada fase perebutan:** response `HTTP 202 Accepted` pada endpoint booking
  memiliki **p95 < 150ms** dan **p99 < 300ms** saat peak.
- **G3 — Decoupling DB write:** request path tidak pernah menunggu operasi tulis berat; persistensi
  dilakukan asynchronous oleh worker.
- **G4 — Idempotensi:** request berulang dengan `Idempotency-Key` yang sama tidak menciptakan
  booking ganda dan mengembalikan response identik (replay cached response).
- **G5 — Hold & rollback kuota:** tiket yang tidak dibayar dalam batas waktu otomatis
  mengembalikan kuota ke pool dan berstatus `EXPIRED`.
- **G6 — Observabilitas & bukti uji beban:** metrik stok akhir, latency p95/p99, dan error rate
  tervalidasi serta terdokumentasi.

### 2.2 Non-Goals (Out-of-Scope)
1. **Integrasi payment gateway nyata** (Midtrans/Xendit/Stripe). Konfirmasi pembayaran disimulasikan
   via mock webhook endpoint. *(Menghindari manajemen secret pihak ketiga & ketergantungan jaringan eksternal saat load test.)*
2. **Multi-node / Redis Cluster / sharding.** Sistem dirancang single-instance Redis + single-node
   Postgres + single-node RabbitMQ. Skala horizontal di luar cakupan iterasi ini.
3. **Refund, reschedule, transfer tiket antar pengguna.** Hanya alur beli → bayar → (kedaluwarsa).
4. **Antarmuka admin (CRUD event/tiket, dashboard analitik).** Data event & tiket disiapkan via seed script.
5. **Autentikasi lanjutan** (OAuth, 2FA, refresh token rotation, RBAC). Hanya register/login JWT sederhana.
6. **Notifikasi email/SMS/WhatsApp.** Status hanya dapat di-poll via API/UI.
7. **Rekomendasi tiket, pencarian, kategorisasi event.** Hanya satu event dengan satu jenis tiket per iterasi.

---

## 3. User Stories & Kriteria Penerimaan (GIVEN / WHEN / THEN)

### Story 1 — Registrasi Pengguna
> Sebagai calon pembeli, saya ingin mendaftar akun agar dapat melakukan pemesanan tiket.

- **AC 1.1**
  - **GIVEN** email belum terdaftar dan payload `{ email, password }` valid (email format RFC-5322, password ≥ 8 karakter).
  - **WHEN** client mengirim `POST /api/auth/register`.
  - **THEN** sistem menyimpan user (password di-hash argon2id), dan merespons `HTTP 201` dengan `{ user_id, email }` — tanpa pernah mengembalikan `password`/hash.
- **AC 1.2**
  - **GIVEN** email sudah terdaftar.
  - **WHEN** client mengirim `POST /api/auth/register` dengan email yang sama.
  - **THEN** sistem merespons `HTTP 409 Conflict` dengan `error.code = "EMAIL_ALREADY_EXISTS"`.
- **AC 1.3**
  - **GIVEN** payload tidak valid (password < 8 karakter atau email malformed).
  - **WHEN** client mengirim `POST /api/auth/register`.
  - **THEN** sistem merespons `HTTP 400` dengan `error.code = "VALIDATION_ERROR"` dan daftar field yang gagal.

### Story 2 — Login & Mendapatkan Token
> Sebagai pengguna terdaftar, saya ingin login untuk mendapatkan token akses.

- **AC 2.1**
  - **GIVEN** user terdaftar dengan password benar.
  - **WHEN** client mengirim `POST /api/auth/login`.
  - **THEN** sistem merespons `HTTP 200` dengan `{ token }` (JWT HS256, masa berlaku 60 menit).
- **AC 2.2**
  - **GIVEN** password salah atau email tidak terdaftar.
  - **WHEN** client mengirim `POST /api/auth/login`.
  - **THEN** sistem merespons `HTTP 401` dengan `error.code = "INVALID_CREDENTIALS"` (pesan tidak membedakan email vs password — mencegah user enumeration).

### Story 3 — Melihat Kuota Tiket
> Sebagai pengguna, saya ingin melihat sisa kuota tiket secara real-time agar tahu peluang saya.

- **AC 3.1**
  - **GIVEN** event aktif dengan kuota tersisa di Redis.
  - **WHEN** client mengirim `GET /api/events/:eventId/quota`.
  - **THEN** sistem merespons `HTTP 200` dengan `{ event_id, remaining }` yang dibaca langsung dari Redis.

### Story 4 — Checkout Tiket (Happy Path)
> Sebagai pengguna, saya ingin mengamankan tiket saat flash sale agar tidak kehabisan.

- **AC 4.1**
  - **GIVEN** user terautentikasi, kuota tersisa ≥ `quantity` yang diminta, dan header `Idempotency-Key` (UUID v4) unik.
  - **WHEN** client mengirim `POST /api/bookings` dengan `{ event_id, quantity }`.
  - **THEN** sistem:
    1. menjalankan **atomic stock decrement via Redis Lua**;
    2. publish job ke RabbitMQ berisi `{ booking_id, user_id, event_id, quantity }`;
    3. menyimpan reservasi di Redis dengan TTL 600 detik;
    4. merespons `HTTP 202 Accepted` dengan `{ booking_id, status: "PENDING", expires_at }`.
- **AC 4.2**
  - **GIVEN** kuota tersisa **0** (habis).
  - **WHEN** client mengirim `POST /api/bookings`.
  - **THEN** sistem merespons `HTTP 410 Gone` dengan `error.code = "SOLD_OUT"`, **tanpa menyentuh database sama sekali**.

### Story 5 — Idempotensi Checkout
> Sebagai pengguna yang panik menekan tombol berkali-kali, saya ingin aksi saya tidak menciptakan
> pesanan ganda.

- **AC 5.1**
  - **GIVEN** request pertama dengan `Idempotency-Key: K` **sedang diproses** (masih `PROCESSING` di Redis).
  - **WHEN** request kedua dengan `Idempotency-Key: K` yang sama masuk.
  - **THEN** sistem **tidak** memotong kuota lagi dan merespons `HTTP 409 Conflict` dengan `error.code = "REQUEST_IN_PROGRESS"`.
- **AC 5.2**
  - **GIVEN** request pertama dengan `Idempotency-Key: K` **sudah selesai** (response tersimpan di Redis).
  - **WHEN** request kedua dengan `Idempotency-Key: K` yang sama masuk.
  - **THEN** sistem mengembalikan **response tersimpan yang identik** (status code & body sama, termasuk `booking_id` yang sama).
- **AC 5.3**
  - **GIVEN** request tanpa header `Idempotency-Key`.
  - **WHEN** client mengirim `POST /api/bookings`.
  - **THEN** sistem merespons `HTTP 400` dengan `error.code = "MISSING_IDEMPOTENCY_KEY"`.

### Story 6 — Rate Limiting
> Sebagai operator, saya ingin membatasi laju request agar sistem tidak dibanjiri trafik jahat/berlebihan.

- **AC 6.1**
  - **GIVEN** client telah melebihi batas token bucket (mis. 10 request/detik per IP).
  - **WHEN** client mengirim request baru.
  - **THEN** sistem merespons `HTTP 429 Too Many Requests` dengan header `Retry-After` dan `error.code = "RATE_LIMITED"`.

### Story 7 — Persistensi Asinkron oleh Worker
> Sebagai operator, saya ingin data pesanan tercatat di database secara andal tanpa membebani request path.

- **AC 7.1**
  - **GIVEN** sebuah job booking berada di queue RabbitMQ.
  - **WHEN** worker consumer mengambil job tersebut.
  - **THEN** worker menulis satu baris ke tabel `bookings` (status `PENDING`) dan baris terkait ke `order_items`, lalu mengirim `ack` ke RabbitMQ.
- **AC 7.2**
  - **GIVEN** worker gagal menulis ke database (mis. DB down).
  - **WHEN** worker memproses job.
  - **THEN** worker mengirim `nack` tanpa requeue-langsung atau requeue terbatas, sehingga job tidak hilang diam-diam (tercatat di log terstruktur).

### Story 8 — Konfirmasi Pembayaran (Mock Webhook)
> Sebagai sistem pembayaran, saya ingin memberi tahu booking service bahwa pembayaran berhasil.

- **AC 8.1**
  - **GIVEN** booking berstatus `PENDING` dan belum kedaluwarsa.
  - **WHEN** sistem menerima `POST /api/payments/callback` dengan `{ booking_id, status: "PAID" }`.
  - **THEN** status booking di database berubah menjadi `PAID` dan sistem merespons `HTTP 200`.
- **AC 8.2**
  - **GIVEN** booking sudah berstatus `EXPIRED`.
  - **WHEN** callback `PAID` datang terlambat.
  - **THEN** sistem menolak dengan `HTTP 409` dan `error.code = "BOOKING_EXPIRED"` (idempoten: status `PAID` tidak boleh menimpa `EXPIRED`).

### Story 9 — Kedaluwarsa Reservasi & Rollback Kuota
> Sebagai operator, saya ingin tiket yang tidak dibayar kembali ke pool agar tidak terbuang.

- **AC 9.1**
  - **GIVEN** booking `PENDING` dibuat dan TTL 600 detik habis tanpa pembayaran.
  - **WHEN** pesan TTL di RabbitMQ masuk ke Dead Letter Queue.
  - **THEN** worker expiry: (1) mengembalikan kuota via `INCRBY ticket:<eventId>:quota <quantity>`, (2) mengubah status booking di database menjadi `EXPIRED`.
- **AC 9.2**
  - **GIVEN** booking sudah `PAID` sebelum TTL habis.
  - **WHEN** pesan expiry diproses.
  - **THEN** sistem **tidak** mengembalikan kuota (guard: cek status `PAID` di DB sebelum rollback).

### Story 10 — Polling Status Booking
> Sebagai pengguna, saya ingin memantau status pesanan saya setelah checkout.

- **AC 10.1**
  - **GIVEN** `booking_id` milik user yang terautentikasi.
  - **WHEN** client mengirim `GET /api/bookings/:bookingId`.
  - **THEN** sistem merespons `HTTP 200` dengan `{ booking_id, status, expires_at, quantity, event_id }` dengan status ∈ `{ PENDING, PAID, EXPIRED, CANCELLED }`.
- **AC 10.2**
  - **GIVEN** `booking_id` milik user **lain**.
  - **WHEN** client mengirim `GET /api/bookings/:bookingId`.
  - **THEN** sistem merespons `HTTP 404` (bukan 403 — mencegah kebocoran keberadaan resource).

### Story 11 — Load Test & Validasi Integritas Kuota
> Sebagai operator, saya ingin membuktikan sistem benar di bawah tekanan.

- **AC 11.1**
  - **GIVEN** kuota awal 100 tiket, script k6 dijalankan dengan 2.000 VU menghantam `POST /api/bookings` secara simultan.
  - **WHEN** load test selesai.
  - **THEN** jumlah booking berstatus `PENDING`+`PAID` di PostgreSQL **tepat 100**, dan sisa kuota di Redis **tepat 0** (tidak ada tiket ke-101 yang lolos).
- **AC 11.2**
  - **GIVEN** skenario load test yang sama.
  - **WHEN** metrik dikumpulkan.
  - **THEN** `http_req_duration` untuk endpoint booking: **p95 < 150ms**, **p99 < 300ms**; error rate (HTTP 5xx) **< 1%**.

---

## 4. Batasan Teknis & Keamanan (Technical & Security Constraints)

### 4.1 Batasan Performa
| Metrik | Target | Catatan |
|---|---|---|
| p95 latency `POST /api/bookings` | < 150 ms | Fase perebutan kuota (Redis only). |
| p99 latency `POST /api/bookings` | < 300 ms | Pada 2.000 concurrent VU. |
| Throughput | ≥ 1.000 req/detik | Diukur pada mesin lokal pengembang. |
| Error rate (5xx) | < 1% | Selama load test. |
| Akurasi kuota | 100% (tepat 100) | Nol overselling. |

### 4.2 Batasan Keamanan
- **Deny-First:** kredensial (DB, Redis, RabbitMQ, `JWT_SECRET`) hanya dari environment variable (`.env`),
  tidak pernah di-hardcode, tidak pernah masuk git (`.gitignore` memblokir `.env`, `.env.*`).
- **Password:** di-hash dengan **argon2id** (`Bun.password`). Tidak pernah di-log atau dikembalikan di response.
- **Input validation:** semua payload eksternal divalidasi di batas controller sebelum masuk service.
- **Anti SQL injection:** seluruh query via `Bun.sql` tagged template (prepared statement by design).
- **Auth:** endpoint mutasi & data privat wajib header `Authorization: Bearer <JWT>`.
- **Rate limiting:** token bucket di Redis untuk mencegah abuse.
- **Tidak ada eksfiltrasi jaringan** ke host eksternal tak sah.

### 4.3 Kompatibilitas Platform & Environment
- **Runtime:** Bun 1.4.2 (atau lebih baru).
- **OS pengembang:** Windows (`win32`), shell PowerShell (perintah bebas chaining `&&`).
- **Redis:** ≥ 7.2 (persyaratan klien Redis Bun).
- **PostgreSQL:** ≥ 15.
- **RabbitMQ:** ≥ 3.13 (disarankan 4.x; `amqplib` ≥ 0.10.7 untuk RabbitMQ 4.1+).
- **Infrastruktur:** Docker Compose (Redis + PostgreSQL + RabbitMQ).
- **Tooling uji:** k6 (load test), `bun test` (unit test), `tsc --noEmit` (typecheck).

---

## 5. Definition of Done (DoD)

Sebuah fitur dinyatakan selesai jika **seluruh** kondisi berikut terpenuhi:
1. Seluruh kriteria penerimaan (GIVEN/WHEN/THEN) terkait memiliki **unit/integration test yang lulus**.
2. **Typecheck 0 error** (`bunx tsc --noEmit`).
3. **Linter bersih** (0 error).
4. **Build/runtime start** berhasil (`bun run src/index.ts` menyala tanpa error).
5. **Verifikasi Tier-2** (bila menyentuh DB/skema): migration nyata dijalankan + query smoke test (`SELECT 1`, insert/select nyata) berhasil.
6. **Dokumentasi sinkron:** `docs/PRD.md` / `docs/ARCHITECTURE.md` diperbarui bila kontrak berubah.
7. **Bukti load test** (untuk fitur inti booking): hasil k6 tersimpan di `loadtest/results/` dan
   memenuhi target §4.1.

---

## 6. Spesifikasi Antarmuka Frontend

Frontend minimal: **HTML + CSS + vanilla JS**, disajikan langsung oleh `Bun.serve` (tanpa framework,
tanpa build step). Tujuan: mendemonstrasikan alur booking end-to-end untuk portofolio.

### 6.1 Daftar Halaman / Rute

| Rute | Halaman | Fungsi |
|---|---|---|
| `/` | **Landing & Login/Register** | Autentikasi pengguna (form login & register). |
| `/event` | **Detail Event & Beli Tiket** | Menampilkan kuota live, form quantity, tombol "Amankan Tiket". |
| `/booking` | **Status Pesanan** | Polling status booking (`PENDING`→`PAID`/`EXPIRED`), tombol simulasi bayar. |

### 6.2 Wireframe Deskriptif

**Halaman `/` — Landing & Auth**
```
┌───────────────────────────────────────────────┐
│  TIKET  [live counter: sisa kuota]            │  ← header tipis, bukan hero gradien
│                                               │
│  Perebutan 100 tiket.                         │
│  Satu klik. Nol tiket ganda.                  │  ← headline kuat (2 baris)
│                                               │
│  ┌─ Masuk ──────────────────────────┐         │
│  │ Email     [___________________]  │         │
│  │ Password  [___________________]  │         │
│  │ [      Masuk      ]              │         │  ← CTA kata kerja aktif
│  │ Belum punya akun? Daftar         │         │
│  └──────────────────────────────────┘         │
└───────────────────────────────────────────────┘
```

**Halaman `/event` — Detail & Beli**
```
┌───────────────────────────────────────────────┐
│  Konser Malam Nusantara            sisa: 87   │
│  Jakarta · 20 Des 2026 · 19:30                │
│  ─────────────────────────────────────────    │
│  Harga         Rp 250.000 / tiket             │
│  Jumlah        [ 1 ▾ ]                        │
│  [        Amankan Tiket        ]              │
│  Kuota diambil selama 10 menit.               │  ← microcopy jujur
└───────────────────────────────────────────────┘
```

**Halaman `/booking` — Status Pesanan**
```
┌───────────────────────────────────────────────┐
│  Pesanan #a1b2c3d4                            │
│  ─────────────────────────────────────────    │
│  Status    ● MENUNGGU PEMBAYARAN              │  ← dot berwarna per status
│  Sisa waktu   09:42                           │  ← countdown dari expires_at
│  [      Simulasikan Pembayaran      ]         │
└───────────────────────────────────────────────┘
```

### 6.3 Design Token Awal
Berdasarkan `skill-frontend-design` (menghindari klise template AI: cream/terracotta, rounded-card kit,
eyebrow caps, panah `→` di tombol). Arah: **"terminal ticket" — gelap, presisi, monospaced untuk angka.**

**Color**
| Token | Hex | Fungsi |
|---|---|---|
| `--bg` | `#0B0E14` | Latar utama (near-black, sedikit biru). |
| `--surface` | `#141925` | Panel/kartu form (satu tone di atas bg, bukan putih). |
| `--ink` | `#E6E9EF` | Teks utama. |
| `--muted` | `#8A93A6` | Teks sekunder/label. |
| `--accent` | `#3DDC97` | Aksi utama & status `PAID` (hijau mint tajam). |
| `--alert` | `#FF5C5C` | Error / status `EXPIRED` / kuota habis. |
| `--pending` | `#FFC857` | Status `PENDING`. |

**Type**
- **Satu keluarga font:** `ui-monospace, "JetBrains Mono", "Cascadia Code", monospace` — konsisten dengan
  tema "ticket terminal", angka kuota & countdown rata lebar (tabular).
- Hirarki: `display` (28–34px, weight 700), `body` (15px, weight 400), `label` (12px, uppercase tracking,
  weight 600), `data` (angka besar, tabular-nums).

**Layout & Spacing**
- Skala spacing: `4 / 8 / 12 / 16 / 24 / 32 / 48` px.
- Lebar konten maksimum: `480px` (form terpusat), `720px` (detail event).
- Garis pemisah (`1px solid --muted` dengan opacity rendah) memisahkan blok konteks, bukan dekorasi.
- Border-radius minimal (`4px`) — hindari "rounded card kit".

**Self-Critique (checklist anti-klise):**
- [x] Bukan cream + terracotta.
- [x] Bukan kartu rounded identik + shadow abu-abu.
- [x] Tidak ada eyebrow ALL-CAPS di atas setiap heading (label caps hanya untuk field form).
- [x] Tidak ada panah `→` menempel di tombol.
- [x] Animasi hanya pada transisi status (reaksi aksi user), bukan fade-slide-up per section.

### 6.4 Komponen Utama per Halaman
- **`/`:** `QuotaCounter` (live, poll tiap 3s), `AuthForm` (toggle login/register), `InlineError`.
- **`/event`:** `QuotaBadge`, `QuantitySelect`, `BookButton`, `Toast` (sukses/gagal).
- **`/booking`:** `StatusDot`, `CountdownTimer` (dari `expires_at`), `PaySimulateButton`, `StatusPoll`.

### 6.5 Perilaku Interaktif (State)
| State | Perilaku |
|---|---|
| **Loading** | Tombol "Amankan Tiket" menampilkan spinner inline & `disabled` selama request; mencegah double-submit (dilengkapi `Idempotency-Key`). |
| **Empty** | Halaman `/booking` tanpa booking aktif: pesan ajakan bertindak — "Belum ada pesanan. Ambil tiketmu di halaman event." + tautan. |
| **Error** | `410 SOLD_OUT` → banner merah "Kuota habis."; `409` → "Pesanan ini sedang diproses, tunggu sebentar."; `429` → "Terlalu banyak percobaan, coba lagi dalam N detik."; error lain → pesan generik + tombol "Coba lagi". |
| **Success** | `202` → redirect ke `/booking` dengan `booking_id`, mulai polling. |
| **Polling** | `GET /api/bookings/:id` setiap 3 detik; berhenti saat status `PAID`/`EXPIRED`. |

### 6.6 Aksesibilitas (wajib)
- Responsif hingga lebar ponsel terkecil (≥ 320px).
- **Visible focus ring** jelas pada semua elemen interaktif.
- Hormati `prefers-reduced-motion` (matikan transisi non-esensial).
- Kontras warna memenuhi **WCAG AA**.
- Countdown & status diumumkan via `aria-live="polite"`.

---

## 7. Spesifikasi API & Kontrak Data

### 7.1 Konvensi Umum
- **Base path:** `/api`
- **Content-Type:** `application/json`
- **Auth:** `Authorization: Bearer <JWT>` untuk endpoint terproteksi.
- **Idempotency:** header `Idempotency-Key: <UUID v4>` pada `POST /api/bookings`.
- **Format error standar:**
  ```json
  {
    "error": {
      "code": "MACHINE_READABLE_CODE",
      "message": "Pesan manusia yang informatif"
    }
  }
  ```
- **Timestamp:** ISO 8601 UTC (contoh `2026-12-20T12:30:00.000Z`).

### 7.2 Tabel Endpoint

| Method | Path | Auth | Deskripsi |
|---|---|---|---|
| POST | `/api/auth/register` | — | Registrasi pengguna baru. |
| POST | `/api/auth/login` | — | Login, mengembalikan JWT. |
| GET | `/api/events/:eventId/quota` | — | Sisa kuota real-time (dari Redis). |
| POST | `/api/bookings` | ✅ | Checkout tiket (idempoten). |
| GET | `/api/bookings/:bookingId` | ✅ | Status booking (polling). |
| POST | `/api/payments/callback` | — (mock) | Simulasi webhook pembayaran. |
| GET | `/health` | — | Health check (Redis, DB, RabbitMQ). |

### 7.3 Detail Request / Response

#### POST `/api/auth/register`
- **Request:** `{ "email": "a@b.com", "password": "secret123" }`
- **201:** `{ "user_id": 1, "email": "a@b.com" }`
- **400:** `VALIDATION_ERROR` · **409:** `EMAIL_ALREADY_EXISTS`

#### POST `/api/auth/login`
- **Request:** `{ "email": "a@b.com", "password": "secret123" }`
- **200:** `{ "token": "<JWT>", "expires_in": 3600 }`
- **401:** `INVALID_CREDENTIALS`

#### GET `/api/events/:eventId/quota`
- **200:** `{ "event_id": 1, "remaining": 87 }`

#### POST `/api/bookings`
- **Headers:** `Authorization: Bearer <JWT>`, `Idempotency-Key: <UUID v4>`
- **Request:** `{ "event_id": 1, "quantity": 1 }`
- **202 (sukses):**
  ```json
  {
    "booking_id": "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
    "status": "PENDING",
    "event_id": 1,
    "quantity": 1,
    "expires_at": "2026-12-20T12:40:00.000Z"
  }
  ```
- **400:** `MISSING_IDEMPOTENCY_KEY` / `VALIDATION_ERROR`
- **409:** `REQUEST_IN_PROGRESS`
- **410:** `SOLD_OUT`
- **429:** `RATE_LIMITED`

#### GET `/api/bookings/:bookingId`
- **200:** `{ "booking_id": "...", "event_id": 1, "quantity": 1, "status": "PENDING", "expires_at": "..." }`
- **404:** `NOT_FOUND`

#### POST `/api/payments/callback`
- **Request:** `{ "booking_id": "3f2504e0-...", "status": "PAID" }`
- **200:** `{ "booking_id": "...", "status": "PAID" }`
- **409:** `BOOKING_EXPIRED`

#### GET `/health`
- **200:** `{ "status": "ok", "redis": "up", "db": "up", "queue": "up" }`
- **503:** salah satu dependency `down`.

### 7.4 Enum & Nilai Tetap
- `booking.status` ∈ `{ PENDING, PAID, EXPIRED, CANCELLED }`
- `Reservation TTL` = 600 detik (10 menit).
- `Idempotency key TTL` = 60 detik.
- `JWT expiry` = 3600 detik.
- `Rate limit` = 10 request / detik / IP.

### 7.5 Ringkasan Skema Data (detail final di `docs/ARCHITECTURE.md`)
- **`users`** — identitas pengguna (email unik, password hash).
- **`tickets`** — definisi event/kuota total.
- **`bookings`** — pesanan (UUID PK, `idempotency_key` UNIQUE, status, `expires_at`).
- **`order_items`** — baris item per booking (relasi ke `bookings` & `tickets`).

> Catatan: `bookings.event_id` mengacu pada `tickets.event_id` (konsisten dengan skema awal pada brief).
> Detail normalisasi & foreign key final ditetapkan di `docs/ARCHITECTURE.md` (GERBANG 2).

---

## 8. Metrik Keberhasilan (Success Metrics)

| Metrik | Target | Cara Verifikasi |
|---|---|---|
| Overselling | 0 (tepat 100 booking) | Query `COUNT` di PostgreSQL + cek `GET .../quota` = 0 setelah k6. |
| p95 latency booking | < 150 ms | Output k6 (`http_req_duration`). |
| p99 latency booking | < 300 ms | Output k6. |
| Error rate (5xx) | < 1% | Output k6 (`http_req_failed`). |
| Duplikasi booking (idempotency) | 0 | Test skenario double-submit. |
| Rollback kuota tepat waktu | 100% dalam ±5s setelah TTL | Test expiry end-to-end. |

---

## 9. Asumsi & Ketergantungan

- Operator menyediakan **Docker Desktop** (Redis, PostgreSQL, RabbitMQ) dan **k6** sebelum Fase Verifikasi Tier-2.
- Mesin pengembangan mampu menjalankan 2.000 VU k6 secara lokal (atau angka VU diturunkan bila resource terbatas, dengan catatan eksplisit di laporan).
- Waktu sistem (clock) antara app, Redis, dan RabbitMQ sinkron (TTL & expiry berbasis waktu broker/Redis).

---

## 10. Risiko Produk

| # | Risiko | Mitigasi |
|---|---|---|
| P1 | Trafik melebihi kapasitas mesin lokal saat load test | Turunkan VU secara bertahap; dokumentasikan batas nyata. |
| P2 | Pesan expiry hilang saat RabbitMQ restart | Queue durable + pesan persistent; opsi periodic sweeper sebagai jaring pengaman. |
| P3 | Ketidaksesuaian stok Redis vs DB setelah crash | Reconciliation script opsional + dokumentasi trade-off (CAP). |

---

*Dokumen ini adalah Single Source of Truth kebutuhan. Perubahan lingkup wajib memperbarui dokumen ini lebih dulu.*
