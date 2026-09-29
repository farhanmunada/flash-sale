/**
 * Frontend logic for all three pages (vanilla JS, no framework).
 * Detects the current page by a data attribute on <body>-less markers.
 */

const API = '/api';
const EVENT_ID = 1;
const POLL_INTERVAL_MS = 3000;

const token = {
  get: () => localStorage.getItem('token'),
  set: (value) => localStorage.setItem('token', value),
  clear: () => localStorage.removeItem('token'),
};

function banner(el, message, kind = 'error') {
  if (!el) return;
  el.textContent = message;
  el.className = `banner ${kind}`;
  el.hidden = false;
}

function hideBanner(el) {
  if (el) el.hidden = true;
}

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers ?? {}) };
  const authToken = token.get();
  if (authToken) headers.Authorization = `Bearer ${authToken}`;

  const response = await fetch(`${API}${path}`, { ...options, headers });
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body };
}

function rupiah(cents) {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(cents / 100);
}

/* ---------------- Landing / auth page ---------------- */
function initAuthPage() {
  const form = document.getElementById('auth-form');
  if (!form) return;

  const bannerEl = document.getElementById('banner');
  const submit = document.getElementById('submit');
  const toggle = document.getElementById('toggle');
  const toggleText = document.getElementById('toggle-text');
  const title = document.getElementById('auth-title');
  let mode = 'login';

  function applyMode() {
    const isLogin = mode === 'login';
    submit.textContent = isLogin ? 'Masuk' : 'Daftar';
    title.textContent = isLogin ? 'Masuk ke akunmu' : 'Buat akun baru';
    toggleText.textContent = isLogin ? 'Belum punya akun?' : 'Sudah punya akun?';
    toggle.textContent = isLogin ? 'Daftar' : 'Masuk';
  }

  toggle.addEventListener('click', () => {
    mode = mode === 'login' ? 'register' : 'login';
    hideBanner(bannerEl);
    applyMode();
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    hideBanner(bannerEl);
    submit.disabled = true;

    const payload = {
      email: document.getElementById('email').value,
      password: document.getElementById('password').value,
    };

    try {
      if (mode === 'register') {
        const { status, body } = await api('/auth/register', { method: 'POST', body: JSON.stringify(payload) });
        if (status !== 201) return banner(bannerEl, body?.error?.message ?? 'Pendaftaran gagal');
        mode = 'login';
        applyMode();
        banner(bannerEl, 'Akun dibuat. Silakan masuk.', 'ok');
        return;
      }

      const { status, body } = await api('/auth/login', { method: 'POST', body: JSON.stringify(payload) });
      if (status !== 200) return banner(bannerEl, body?.error?.message ?? 'Login gagal');
      token.set(body.token);
      window.location.href = '/event.html';
    } finally {
      submit.disabled = false;
    }
  });

  applyMode();
}

/* ---------------- Event page ---------------- */
function initEventPage() {
  const bookButton = document.getElementById('book');
  if (!bookButton) return;

  const bannerEl = document.getElementById('banner');
  const quotaEl = document.getElementById('quota');
  const nameEl = document.getElementById('event-name');
  const metaEl = document.getElementById('event-meta');
  const priceEl = document.getElementById('price');

  async function refresh() {
    const [eventRes, quotaRes] = await Promise.all([api(`/events/${EVENT_ID}`), api(`/events/${EVENT_ID}/quota`)]);
    if (eventRes.status === 200) {
      nameEl.textContent = eventRes.body.name;
      priceEl.textContent = rupiah(eventRes.body.price_cents);
      metaEl.textContent = eventRes.body.starts_at ? new Date(eventRes.body.starts_at).toLocaleString('id-ID') : 'Jadwal menyusul';
    }
    if (quotaRes.status === 200) quotaEl.textContent = quotaRes.body.remaining;
  }

  bookButton.addEventListener('click', async () => {
    hideBanner(bannerEl);
    if (!token.get()) {
      window.location.href = '/';
      return;
    }

    bookButton.disabled = true;
    bookButton.textContent = 'Memproses…';

    const quantity = Number(document.getElementById('quantity').value);
    const { status, body } = await api('/bookings', {
      method: 'POST',
      headers: { 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({ event_id: EVENT_ID, quantity }),
    });

    bookButton.disabled = false;
    bookButton.textContent = 'Amankan Tiket';

    if (status === 202) {
      sessionStorage.setItem('booking_id', body.booking_id);
      window.location.href = '/booking.html';
      return;
    }
    if (status === 410) return banner(bannerEl, 'Kuota habis.');
    if (status === 409) return banner(bannerEl, 'Pesanan ini sedang diproses, tunggu sebentar.');
    if (status === 429) return banner(bannerEl, 'Terlalu banyak percobaan. Coba lagi sebentar lagi.');
    if (status === 401) {
      token.clear();
      window.location.href = '/';
      return;
    }
    banner(bannerEl, body?.error?.message ?? 'Gagal mengamankan tiket. Coba lagi.');
  });

  void refresh();
  setInterval(refresh, POLL_INTERVAL_MS);
}

/* ---------------- Booking status page ---------------- */
function initBookingPage() {
  const card = document.getElementById('card');
  if (!card) return;

  const empty = document.getElementById('empty');
  const bannerEl = document.getElementById('banner');
  const bookingId = sessionStorage.getItem('booking_id');

  if (!bookingId) {
    empty.hidden = false;
    return;
  }

  const els = {
    id: document.getElementById('booking-id'),
    status: document.getElementById('status'),
    dot: document.getElementById('dot'),
    countdown: document.getElementById('countdown'),
    quantity: document.getElementById('quantity'),
    pay: document.getElementById('pay'),
  };

  let pollTimer = null;
  let countdownTimer = null;
  let expiresAt = null;

  function renderCountdown() {
    if (!expiresAt) return;
    const ms = expiresAt - Date.now();
    if (ms <= 0) {
      els.countdown.textContent = '00:00';
      return;
    }
    const total = Math.floor(ms / 1000);
    const mm = String(Math.floor(total / 60)).padStart(2, '0');
    const ss = String(total % 60).padStart(2, '0');
    els.countdown.textContent = `${mm}:${ss}`;
  }

  function stopTimers() {
    if (pollTimer) clearInterval(pollTimer);
    if (countdownTimer) clearInterval(countdownTimer);
  }

  function render(booking) {
    card.hidden = false;
    empty.hidden = true;
    els.id.textContent = `#${booking.booking_id.slice(0, 8)}`;
    els.status.textContent = booking.status;
    els.dot.className = `dot ${booking.status}`;
    els.quantity.textContent = booking.quantity;
    expiresAt = new Date(booking.expires_at).getTime();
    els.pay.hidden = booking.status !== 'PENDING';
    renderCountdown();
    if (booking.status !== 'PENDING') stopTimers();
  }

  async function poll() {
    const { status, body } = await api(`/bookings/${bookingId}`);
    if (status === 200) return render(body);
    if (status === 404) {
      banner(bannerEl, 'Pesanan tidak ditemukan.');
      stopTimers();
      return;
    }
    if (status === 401) {
      token.clear();
      window.location.href = '/';
    }
  }

  els.pay.addEventListener('click', async () => {
    els.pay.disabled = true;
    const { status, body } = await api('/payments/callback', {
      method: 'POST',
      body: JSON.stringify({ booking_id: bookingId, status: 'PAID' }),
    });
    els.pay.disabled = false;
    if (status === 200) {
      banner(bannerEl, 'Pembayaran dikonfirmasi.', 'ok');
      await poll();
      return;
    }
    banner(bannerEl, body?.error?.message ?? 'Pembayaran gagal.');
  });

  void poll();
  pollTimer = setInterval(poll, POLL_INTERVAL_MS);
  countdownTimer = setInterval(renderCountdown, 1000);
}

initAuthPage();
initEventPage();
initBookingPage();
