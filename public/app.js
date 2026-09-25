const API = '/api';
let settings = {};
let currentPage = 'dashboard';
let editingPrevStatus = null;
let editingPrevPay = null;

// Tambahkan token ke semua request fetch secara otomatis
const originalFetch = window.fetch;
window.fetch = function (input, init) {
  init = init || {};
  const token = localStorage.getItem('token');
  if (token) {
    init.headers = Object.assign({}, init.headers, { 'Authorization': 'Bearer ' + token });
  }
  const p = originalFetch.call(this, input, init);
  if (token) {
    p.then(res => {
      if (res.status === 401 && String(input).indexOf('/auth/login') < 0) {
        setToken(null);
        showLogin();
      }
      if (res.status === 403) {
        res.clone().json().then(j => {
          if (j && (j.code === 'SUBSCRIPTION_EXPIRED' || j.code === 'SUSPENDED')) {
            loadSubscription(true);
          }
        }).catch(() => {});
      }
    });
  }
  return p;
};

// Auth helpers
function getToken() {
  return localStorage.getItem('token');
}

function setToken(t) {
  if (t) localStorage.setItem('token', t);
  else localStorage.removeItem('token');
}

function showLogin() {
  document.getElementById('login-overlay').classList.add('open');
  document.getElementById('login-username').value = '';
  document.getElementById('login-password').value = '';
  document.getElementById('login-error').textContent = '';
  setTimeout(() => document.getElementById('login-username').focus(), 50);
}

function hideLogin() {
  document.getElementById('login-overlay').classList.remove('open');
}

function showApp() {
  document.getElementById('btn-logout').style.display = '';
}

// Navigation
document.querySelectorAll('.nav-link').forEach(link => {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    const page = link.dataset.page;
    if (!page) return;
    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
    link.classList.add('active');
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById(`page-${page}`).classList.add('active');
    currentPage = page;
    if (page === 'dashboard') loadDashboard();
    if (page === 'receipts') loadReceipts();
    if (page === 'kasir') loadKasir();
    if (page === 'report') loadReport();
    if (page === 'settings') loadSettings();
  });
});

// Format currency
function formatRupiah(n) {
  return 'Rp ' + Number(n || 0).toLocaleString('id-ID');
}

// Nominal diskon ('percent' = % dari estimasi, 'rp' = rupiah)
function discountAmount(r) {
  const est = Number((r && r.estimated_cost) || 0);
  const v = Number((r && r.discount_value) || 0);
  const t = (r && r.discount_type) || '';
  if (t === 'percent') return Math.round(est * v / 100);
  if (t === 'rp') return Math.round(v);
  return 0;
}

// Sisa bayar setelah diskon (lunas -> 0, sejalan cetak)
function remainAmount(r) {
  if ((r && r.payment_status) === 'lunas') return 0;
  const est = Number((r && r.estimated_cost) || 0);
  return est - discountAmount(r) - Number((r && r.down_payment) || 0);
}

// Parse input rupiah (menerima "950.000", "950000", "950,000")
function parseRupiah(s) {
  const n = parseInt(String(s || '0').replace(/[^\d]/g, ''), 10);
  return isNaN(n) ? 0 : n;
}

// Tampilkan angka dengan pemisah ribuan "950.000"
function numId(n) {
  return Number(n || 0).toLocaleString('id-ID');
}

// Status badge
function statusBadge(status) {
  const labels = {
    diterima: 'Diterima',
    diproses: 'Diproses',
    selesai: 'Selesai',
    diantar: 'Diantar',
    diambil: 'Diambil',
    batal: 'Batal'
  };
  return `<span class="status-badge status-${status}">${labels[status] || status}</span>`;
}

function fmtDateStr(s) {
  if (!s) return '';
  const p = String(s).split('-');
  if (p.length !== 3) return s;
  return `${p[2]}/${p[1]}/${p[0]}`;
}

function todayISO() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function isOverdue(r) {
  return r.payment_status === 'hutang' && !!r.due_date && String(r.due_date) <= todayISO();
}

// Label metode pembayaran (Dibayar Via): cash/transfer/qris
function settleLabel(m) {
  if (m === 'transfer') return 'Transfer Bank';
  if (m === 'qris') return 'QRIS';
  if (m === 'cash') return 'Cash';
  return '';
}

function payText(r) {
  const ps = r.payment_status || '';
  if (ps === 'hutang') {
    return 'Hutang' + (r.due_date ? ' · jatuh tempo ' + fmtDateStr(r.due_date) : '');
  }
  if (ps === 'lunas') {
    const m = settleLabel(r.settle_method);
    return 'Lunas' + (m ? ' · ' + m : '') + (r.settle_date ? ' · ' + fmtDateStr(r.settle_date) : '');
  }
  if (ps === 'cash') return 'Cash';
  return 'Kosong';
}

function paymentBadge(r) {
  const ps = r.payment_status || '';
  if (ps === 'hutang') {
    const overdue = isOverdue(r);
    return `<span class="pay-badge pay-hutang${overdue ? ' pay-due' : ''}">Hutang${r.due_date ? ' · ' + fmtDateStr(r.due_date) : ''}${overdue ? ' ⚠' : ''}</span>`;
  }
  if (ps === 'lunas') {
    const m = settleLabel(r.settle_method);
    return `<span class="pay-badge pay-lunas">Lunas${m ? ' · ' + m : ''}${r.settle_date ? ' · ' + fmtDateStr(r.settle_date) : ''}</span>`;
  }
  if (ps === 'cash') return `<span class="pay-badge pay-cash">Cash</span>`;
  return `<span class="pay-badge pay-none">Kosong</span>`;
}

// Toast notification
function showToast(msg, type = 'success') {
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

// ============ DASHBOARD ============
async function loadDashboard() {
  try {
    const [stats, receipts] = await Promise.all([
      fetch(`${API}/stats`).then(r => r.json()),
      fetch(`${API}/receipts`).then(r => r.json())
    ]);

    document.getElementById('stats-grid').innerHTML = `
      <div class="stat-card blue">
        <div class="stat-value">${stats.total}</div>
        <div class="stat-label">Total Transaksi</div>
      </div>
      <div class="stat-card orange">
        <div class="stat-value">${stats.diterima}</div>
        <div class="stat-label">Diterima</div>
      </div>
      <div class="stat-card teal">
        <div class="stat-value">${stats.diproses}</div>
        <div class="stat-label">Diproses</div>
      </div>
      <div class="stat-card green">
        <div class="stat-value">${stats.selesai}</div>
        <div class="stat-label">Selesai</div>
      </div>
      <div class="stat-card cyan">
        <div class="stat-value">${stats.diantar || 0}</div>
        <div class="stat-label">Diantar</div>
      </div>
      <div class="stat-card red">
        <div class="stat-value">${stats.batal || 0}</div>
        <div class="stat-label">Batal</div>
      </div>
      <div class="stat-card orange">
        <div class="stat-value">${stats.hutang || 0}</div>
        <div class="stat-label">Hutang</div>
      </div>
      <div class="stat-card red">
        <div class="stat-value">${formatRupiah(stats.todayRevenue)}</div>
        <div class="stat-label">Pemasukan Hari Ini</div>
      </div>
      <div class="stat-card green">
        <div class="stat-value">${formatRupiah(stats.kasirTodayOmzet || 0)}</div>
        <div class="stat-label">Omzet Kasir Hari Ini</div>
      </div>
      <div class="stat-card purple">
        <div class="stat-value">${stats.kasirTodayCount || 0}</div>
        <div class="stat-label">Penjualan Hari Ini</div>
      </div>
      <div class="stat-card orange">
        <div class="stat-value">${stats.totalProducts || 0}</div>
        <div class="stat-label">Jumlah Produk</div>
      </div>
      <div class="stat-card teal">
        <div class="stat-value">${formatRupiah(stats.kasirOmzet || 0)}</div>
        <div class="stat-label">Total Omzet Kasir</div>
      </div>
      <div class="stat-card green">
        <div class="stat-value">${formatRupiah(stats.kasirLaba || 0)}</div>
        <div class="stat-label">Laba Kotor Kasir</div>
      </div>
      <div class="stat-card cyan">
        <div class="stat-value">${Number(stats.kasirMargin || 0).toLocaleString('id-ID', { maximumFractionDigits: 1 })}%</div>
        <div class="stat-label">Margin Kasir</div>
      </div>
      <div class="stat-card purple">
        <div class="stat-value">${formatRupiah(stats.kasirTodayLaba || 0)}</div>
        <div class="stat-label">Laba Kotor Hari Ini</div>
      </div>
    `;

    const tbody = document.querySelector('#recent-table tbody');

    const dueList = (receipts || []).filter(isOverdue);
    const banner = document.getElementById('due-banner');
    if (dueList.length) {
      banner.innerHTML = `<strong>⚠ ${dueList.length} tanda terima hutang sudah jatuh tempo:</strong>` +
        `<ul>${dueList.slice(0, 5).map(r =>
          `<li>${r.receipt_number} — ${escapeHtml(r.customer_name || '')} (jatuh tempo ${fmtDateStr(r.due_date)})</li>`
        ).join('')}${dueList.length > 5 ? `<li>…dan ${dueList.length - 5} lainnya</li>` : ''}</ul>`;
      banner.style.display = 'block';
    } else {
      banner.style.display = 'none';
    }

    if (receipts.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="empty-state"><div class="empty-icon">📋</div><p>Belum ada tanda terima</p></td></tr>`;
      return;
    }

    tbody.innerHTML = receipts.slice(0, 10).map(r => `
      <tr>
        <td><strong>${r.receipt_number}</strong></td>
        <td>${r.customer_name}</td>
        <td>${r.device_type} ${r.device_brand}</td>
        <td>${statusBadge(r.status)}</td>
        <td>${formatDate(r.created_at)}</td>
      </tr>
    `).join('');
  } catch (err) {
    showToast('Gagal memuat data', 'error');
  }
}

function formatDate(d) {
  if (!d) return '-';
  const dt = new Date(d);
  return dt.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ============ RECEIPTS ============
async function loadReceipts() {
  const search = document.getElementById('search-input').value;
  const status = document.getElementById('filter-status').value;

  try {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (status) params.set('status', status);
    if (receiptTab === 'hutang') params.set('payment', 'hutang');
    else if (receiptTab === 'lunas') params.set('payment', 'lunas');

    const receipts = await fetch(`${API}/receipts?${params}`).then(r => r.json());
    const tbody = document.querySelector('#receipts-table tbody');

    if (receipts.length === 0) {
      tbody.innerHTML = `<tr><td colspan="12" class="empty-state"><div class="empty-icon">📋</div><p>Tidak ada data ditemukan</p></td></tr>`;
      return;
    }

    tbody.innerHTML = receipts.map(r => `
      <tr>
        <td><strong>${r.receipt_number}</strong></td>
        <td>${r.customer_name}</td>
        <td>${r.customer_phone || '-'}</td>
        <td>${r.device_type} ${r.device_brand} ${r.device_model}</td>
        <td title="${escapeHtml(r.complaint)}">${truncate(r.complaint, 40)}</td>
        <td title="${escapeHtml(((r.notes || '') + (r.delivery_note ? ' | Diantar: ' + r.delivery_note : '')).trim())}">${truncate(((r.notes || '') + (r.delivery_note ? ' | Diantar: ' + r.delivery_note : '')).trim() || '-', 40)}</td>
        <td>${formatRupiah(r.estimated_cost)}</td>
        <td>${formatRupiah(discountAmount(r))}</td>
        <td>${formatRupiah(r.down_payment)}</td>
        <td>${paymentBadge(r)}</td>
        <td>${statusBadge(r.status)}</td>
        <td>
          <div class="btn-group">
            <button class="btn btn-sm btn-secondary" onclick="editReceipt(${r.id})" title="Edit">✏️</button>
            <button class="btn btn-sm btn-success" onclick="printReceipt(${r.id})" title="Cetak">🖨️</button>
            <button class="btn btn-sm btn-secondary" onclick="shareStatusLink(${r.id})" title="Kirim link status via WhatsApp">🔗</button>
            <div class="export-menu">
              <button class="btn btn-sm btn-primary" title="Export PDF">📄</button>
              <div class="export-options">
                <a onclick="exportReceipt(${r.id},'a4')">PDF A4</a>
                <a onclick="exportReceipt(${r.id},'half')">PDF Setengah A4</a>
              </div>
            </div>
            <button class="btn btn-sm btn-danger" onclick="deleteReceipt(${r.id})" title="Hapus">🗑️</button>
          </div>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    showToast('Gagal memuat data', 'error');
  }
}

function escapeHtml(s) {
  if (!s) return '';
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function truncate(s, n) {
  if (!s) return '-';
  return s.length > n ? s.substring(0, n) + '...' : s;
}

document.getElementById('search-input').addEventListener('input', debounce(loadReceipts, 300));
document.getElementById('filter-status').addEventListener('change', loadReceipts);

// Tab pembayaran: Semua / Hutang / Lunas
let receiptTab = 'semua';
document.querySelectorAll('#receipt-tabs .tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    receiptTab = btn.dataset.tab;
    document.querySelectorAll('#receipt-tabs .tab-btn').forEach(b => b.classList.toggle('active', b === btn));
    loadReceipts();
  });
});

function toggleSettleFields() {
  const row = document.getElementById('settle-row');
  const on = document.getElementById('f-payment_status').value === 'lunas';
  row.style.display = on ? '' : 'none';
}
document.getElementById('f-payment_status').addEventListener('change', toggleSettleFields);

function toggleDeliveryGroup() {
  const grp = document.getElementById('f-delivery-group');
  const on = document.getElementById('f-status').value === 'diantar';
  grp.style.display = on ? '' : 'none';
}
document.getElementById('f-status').addEventListener('change', toggleDeliveryGroup);

// Preview sisa bayar setelah diskon di form
function updateSisaHint() {
  const el = document.getElementById('f-sisa-hint');
  if (!el) return;
  const est = parseRupiah(document.getElementById('f-estimated_cost').value);
  const dp = parseRupiah(document.getElementById('f-down_payment').value);
  const r = {
    estimated_cost: est,
    down_payment: dp,
    discount_type: document.getElementById('f-discount_type').value,
    discount_value: parseRupiah(document.getElementById('f-discount_value').value)
  };
  const disc = discountAmount(r);
  el.textContent = 'Sisa Bayar: ' + formatRupiah(est - disc - dp) + (disc ? ' (Diskon ' + formatRupiah(disc) + ')' : '');
}
['f-estimated_cost', 'f-down_payment', 'f-discount_value'].forEach(idf => {
  document.getElementById(idf).addEventListener('input', debounce(updateSisaHint, 120));
});
document.getElementById('f-discount_type').addEventListener('change', updateSisaHint);

function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

// ============ MODAL / FORM ============
const modal = document.getElementById('modal');

document.getElementById('btn-new').addEventListener('click', () => {
  openModal();
});

document.getElementById('modal-close').addEventListener('click', closeModal);
document.getElementById('btn-cancel').addEventListener('click', closeModal);

modal.addEventListener('click', (e) => {
  if (e.target === modal) closeModal();
});

function openModal(data = null) {
  modal.classList.add('open');
  document.getElementById('receipt-form').reset();
  document.getElementById('f-id').value = '';

  if (data) {
    document.getElementById('modal-title').textContent = 'Edit Tanda Terima';
    document.getElementById('f-id').value = data.id;
    document.getElementById('f-receipt_number').value = data.receipt_number;
    document.getElementById('f-date').value = data.created_at;
    document.getElementById('f-customer_name').value = data.customer_name;
    document.getElementById('f-customer_phone').value = data.customer_phone || '';
    document.getElementById('f-customer_address').value = data.customer_address || '';
    document.getElementById('f-device_type').value = data.device_type || '';
    document.getElementById('f-device_brand').value = data.device_brand || '';
    document.getElementById('f-device_model').value = data.device_model || '';
    document.getElementById('f-device_serial').value = data.device_serial || '';
    document.getElementById('f-complaint').value = data.complaint || '';
    document.getElementById('f-notes').value = data.notes || '';
    document.getElementById('f-delivery_note').value = data.delivery_note || '';
    document.getElementById('f-estimated_cost').value = numId(data.estimated_cost);
    document.getElementById('f-down_payment').value = numId(data.down_payment);
    document.getElementById('f-discount_type').value = data.discount_type || '';
    document.getElementById('f-discount_value').value = data.discount_value ? numId(data.discount_value) : '0';
    document.getElementById('f-discount_note').value = data.discount_note || '';
    document.getElementById('f-status').value = data.status || 'diterima';
    document.getElementById('f-payment_status').value = data.payment_status || '';
    document.getElementById('f-due_date').value = data.due_date || '';
    document.getElementById('f-settle_method').value = data.settle_method || '';
    document.getElementById('f-settle_date').value = data.settle_date || '';
  } else {
    document.getElementById('modal-title').textContent = 'Tanda Terima Baru';
    document.getElementById('f-receipt_number').value = '(auto)';
    document.getElementById('f-date').value = new Date().toLocaleDateString('id-ID');
    document.getElementById('f-payment_status').value = '';
    document.getElementById('f-due_date').value = '';
    document.getElementById('f-settle_method').value = '';
    document.getElementById('f-settle_date').value = '';
    document.getElementById('f-create-more').checked = true;
  }
  toggleSettleFields();
  toggleDeliveryGroup();
  editingPrevStatus = data ? (data.status || '') : null;
  editingPrevPay = data ? (data.payment_status || '') : null;
  updateSisaHint();
}

function closeModal() {
  modal.classList.remove('open');
}

async function editReceipt(id) {
  try {
    const data = await fetch(`${API}/receipts/${id}`).then(r => r.json());
    openModal(data);
  } catch (err) {
    showToast('Gagal memuat data', 'error');
  }
}

// Save form
document.getElementById('notif-close').addEventListener('click', closeStatusNotif);

document.getElementById('receipt-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('f-id').value;
  const body = {
    customer_name: document.getElementById('f-customer_name').value,
    customer_phone: document.getElementById('f-customer_phone').value,
    customer_address: document.getElementById('f-customer_address').value,
    device_type: document.getElementById('f-device_type').value,
    device_brand: document.getElementById('f-device_brand').value,
    device_model: document.getElementById('f-device_model').value,
    device_serial: document.getElementById('f-device_serial').value,
    complaint: document.getElementById('f-complaint').value,
    notes: document.getElementById('f-notes').value,
    delivery_note: document.getElementById('f-delivery_note').value,
    estimated_cost: parseRupiah(document.getElementById('f-estimated_cost').value),
    down_payment: parseRupiah(document.getElementById('f-down_payment').value),
    discount_type: document.getElementById('f-discount_type').value,
    discount_value: parseRupiah(document.getElementById('f-discount_value').value),
    discount_note: document.getElementById('f-discount_note').value,
    status: document.getElementById('f-status').value
  };

  const payStatus = document.getElementById('f-payment_status').value;
  const dueDate = document.getElementById('f-due_date').value;
  const settleMethod = document.getElementById('f-settle_method').value;
  const settleDate = document.getElementById('f-settle_date').value;
  if (payStatus === 'hutang' && !dueDate) {
    showToast('Tanggal jatuh tempo wajib diisi untuk status Hutang', 'error');
    return;
  }
  if (payStatus === 'lunas') {
    if (!settleMethod) {
      showToast('Pilih metode pembayaran (Cash / Transfer Bank / QRIS) untuk status Lunas', 'error');
      return;
    }
    if (!settleDate) {
      showToast('Tanggal lunas wajib diisi untuk status Lunas', 'error');
      return;
    }
  }
  body.payment_status = payStatus;
  body.due_date = payStatus === 'hutang' ? dueDate : '';
  body.settle_method = payStatus === 'lunas' ? settleMethod : '';
  body.settle_date = payStatus === 'lunas' ? settleDate : '';

  const notifyNeeded = !id || (editingPrevStatus !== null && body.status !== editingPrevStatus);

  try {
    const url = id ? `${API}/receipts/${id}` : `${API}/receipts`;
    const method = id ? 'PUT' : 'POST';
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!res.ok) throw new Error();
    const saved = await res.json();

    showToast(id ? 'Tanda terima berhasil diupdate' : 'Tanda terima berhasil dibuat');

    // Notifikasi: panel konfirmasi di dalam halaman (bukan window.open) agar
    // tidak diblokir popup blocker. Tujuan: Pelanggan (data baru / status
    // berubah) dan Pemilik toko (peristiwa Diantar / Diambil / Batal /
    // Hutang baru / Lunas).
    const info = saved || {
      receipt_number: document.getElementById('f-receipt_number').value,
      customer_name: document.getElementById('f-customer_name').value,
      customer_phone: document.getElementById('f-customer_phone').value,
      device_type: document.getElementById('f-device_type').value,
      device_brand: document.getElementById('f-device_brand').value,
      device_model: document.getElementById('f-device_model').value
    };
    const items = [];
    if (notifyNeeded) {
      items.push({ label: 'Pelanggan', wa: waPhone(info.customer_phone) || '', msg: statusNotifMsg(body.status, info.receipt_number, fmtDevice(info)) });
    }
    const ownerEvents = ownerNotifEvents(body, notifyNeeded, !id || body.payment_status !== editingPrevPay);
    const ownerWa = (settings && settings.shop_phone) ? waPhone(settings.shop_phone) : '';
    if (ownerEvents.length && ownerWa) {
      items.push({ label: 'Pemilik', wa: ownerWa, msg: ownerNotifMsg(ownerEvents, info) });
    }
    if (items.length) showNotifPanel(items);
    editingPrevStatus = null;
    editingPrevPay = null;

    const createMore = !id && document.getElementById('f-create-more').checked;
    if (createMore) {
      openModal(null);
      document.getElementById('f-create-more').checked = true;
    } else {
      closeModal();
    }
    if (currentPage === 'receipts') loadReceipts();
    else if (currentPage === 'dashboard') loadDashboard();
  } catch (err) {
    showToast('Gagal menyimpan data', 'error');
  }
});

// Pesan notifikasi status untuk WhatsApp
function statusNotifMsg(status, receiptNumber, device) {
  const msgs = {
    diterima: 'Barang Anda sudah KAMI TERIMA dan siap dikerjakan.',
    diproses: 'Perbaikan barang Anda sedang DIKERJAKAN teknisi kami.',
    selesai: 'Perbaikan barang Anda sudah SELESAI dan siap diambil. Mohon segera datang untuk pengambilan.',
    diantar: 'Barang Anda sedang DIANTAR. Silakan tunggu kedatangan pengiriman.',
    diambil: 'Barang Anda sudah DIAMBIL. Terima kasih atas kepercayaannya.',
    batal: 'Tanda terima Anda kami BATALKAN. Silakan hubungi kami jika ada pertanyaan.'
  };
  return `🔧 *Status Service - ${receiptNumber}*\n\n` +
    `Device: ${device || '-'}\n\n` +
    `${msgs[status] || 'Status perbaikan Anda berubah.'}\n\n` +
    `Terima kasih🙏`;
}

// Nama device ringkas dari objek tanda terima
function fmtDevice(d) {
  return ([d.device_type, d.device_brand, d.device_model])
    .map(x => (x || '').trim()).filter(Boolean).join(' ');
}

// Peristiwa yang memicu notif pemilik toko (Diantar, Diambil, Batal,
// Hutang baru, Lunas).
function ownerNotifEvents(body, statusChanged, payChanged) {
  const evs = [];
  if (statusChanged) {
    if (body.status === 'diantar') evs.push('Barang sedang DIANTAR ke pelanggan.');
    else if (body.status === 'diambil') evs.push('Barang sudah DIAMBIL oleh pelanggan.');
    else if (body.status === 'batal') evs.push('Tanda terima ini di BATALKAN.');
  }
  if (payChanged) {
    if (body.payment_status === 'hutang') {
      evs.push('Pembayaran dicatat HUTANG' + (body.due_date ? ` (jatuh tempo ${body.due_date})` : '') + '.');
    } else if (body.payment_status === 'lunas') {
      const m = settleLabel(body.settle_method);
      evs.push('Pembayaran LUNAS' + (m ? ` via ${m}` : '') + (body.settle_date ? ` (${body.settle_date})` : '') + '.');
    }
  }
  return evs;
}

// Pesan notifikasi pemilik toko untuk WhatsApp
function ownerNotifMsg(events, info) {
  const d = info || {};
  return `🔔 *Notif Pemilik* - ${(settings && settings.shop_name) || ''}\n\n` +
    `No: ${d.receipt_number || '-'}\n` +
    `Pelanggan: ${d.customer_name || '-'}\n` +
    `Device: ${fmtDevice(d) || '-'}\n\n` +
    events.join('\n') + '\n\n' +
    `Waktu: ${new Date().toLocaleString('id-ID')}`;
}

// Konfirmasi notifikasi memakai panel di dalam halaman (tidak diblokir browser).
function showNotifPanel(items) {
  const overlay = document.getElementById('notif-overlay');
  const box = overlay.querySelector('.notif-box');
  box.querySelector('h3').textContent = items.length > 1 ? '🔔 Kirim notifikasi?' : '🔔 Kirim notifikasi status?';
  document.getElementById('notif-msg').textContent = items.map(it => it.msg).join('\n\n--------\n\n');

  const actions = document.getElementById('notif-actions');
  actions.innerHTML = '';
  items.forEach(it => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-primary';
    btn.textContent = it.wa
      ? (items.length === 1 ? 'Ya, Kirim WhatsApp' : ('Kirim WhatsApp ' + (it.label ? `(${it.label})` : '')))
      : 'Salin Pesan';
    btn.onclick = function () {
      overlay.style.display = 'none';
      if (it.wa) {
        window.open('https://wa.me/' + it.wa + '?text=' + encodeURIComponent(it.msg), '_blank');
      } else {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(it.msg);
        } else {
          const ta = document.createElement('textarea');
          ta.value = it.msg;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          ta.remove();
        }
        showToast('Pesan disalin ke clipboard');
      }
    };
    actions.appendChild(btn);
  });
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'btn btn-secondary';
  close.textContent = 'Tutup';
  close.onclick = closeStatusNotif;
  actions.appendChild(close);
  overlay.style.display = 'flex';
}

function closeStatusNotif() {
  document.getElementById('notif-overlay').style.display = 'none';
}

// Delete
async function deleteReceipt(id) {
  if (!confirm('Yakin ingin menghapus tanda terima ini?')) return;
  try {
    await fetch(`${API}/receipts/${id}`, { method: 'DELETE' });
    showToast('Tanda terima berhasil dihapus');
    loadReceipts();
  } catch (err) {
    showToast('Gagal menghapus data', 'error');
  }
}

// Normalisasi nomor HP ke format WA (628xx)
function waPhone(p) {
  if (!p) return '';
  let n = String(p).replace(/[^\d]/g, '');
  if (n.startsWith('0')) n = '62' + n.slice(1);
  else if (n.startsWith('8')) n = '62' + n;
  return n;
}

// Kirim link status pelanggan via WhatsApp
async function shareStatusLink(id) {
  try {
    const r = await fetch(`${API}/receipts/${id}`).then(x => x.json());
    const u = encodeURIComponent(localStorage.getItem('shop_user') || '');
    const url = `${location.origin}/track.html?u=${u}&no=${encodeURIComponent(r.receipt_number)}&hp=${encodeURIComponent(r.customer_phone || '')}`;
    const wa = waPhone(r.customer_phone);
    if (wa) {
      const msg = `🔧 *Status Service - ${r.receipt_number}*\n\nPerangkat: ${[r.device_type, r.device_brand, r.device_model].filter(Boolean).join(' ')}\n\nCek status perbaikan Anda di sini:\n${url}`;
      window.open(`https://wa.me/${wa}?text=${encodeURIComponent(msg)}`, '_blank');
    } else {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        const ta = document.createElement('textarea');
        ta.value = url;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
      showToast('Pelanggan belum punya no. HP. Link disalin.');
    }
  } catch (err) {
    showToast('Gagal membuat link', 'error');
  }
}

// Export PDF
async function exportReceipt(id, format) {
  const path = format === 'half' ? `${API}/receipts/${id}/export/half` : `${API}/receipts/${id}/export`;
  try {
    const res = await fetch(path, {
      headers: { 'Authorization': 'Bearer ' + localStorage.getItem('token') }
    });
    if (!res.ok) throw new Error();
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const r = await fetch(`${API}/receipts/${id}`, { headers: { 'Authorization': 'Bearer ' + localStorage.getItem('token') } }).then(x => x.json());
    a.download = `${r.receipt_number}${format === 'half' ? '-half' : ''}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
    showToast('PDF berhasil diunduh');
  } catch (err) {
    showToast('Gagal export PDF', 'error');
  }
}

// ============ PRINT RECEIPT ============
let printData = null;
async function printReceipt(id) {
  try {
    const r = await fetch(`${API}/receipts/${id}`).then(r => r.json());
    const s = await fetch(`${API}/settings`).then(r => r.json());
    settings = s;
    printData = r;
    document.getElementById('print-size').value = 'dotmatrix';
    renderPrint();
    document.getElementById('print-preview').classList.add('open');
  } catch (err) {
    showToast('Gagal memuat data cetak', 'error');
  }
}

function renderPrint() {
  if (!printData) return;
  const r = printData;
  const isSale = !!r.sale_number;
  const size = document.getElementById('print-size').value;

  const content = document.getElementById('print-content');
  content.className = `print-sheet print-${size}`;

  document.body.classList.remove('printing-dotmatrix', 'printing-halfa4', 'printing-a4');
  document.body.classList.add(`printing-${size}`);

  if (isSale) {
    if (size === 'a4') {
      content.innerHTML = renderSaleA4(r);
    } else if (size === 'halfa4') {
      content.innerHTML = renderSaleHalfA4(r);
    } else {
      content.innerHTML = renderSaleDotMatrix(r);
    }
    return;
  }

  if (size === 'a4') {
    content.innerHTML = renderA4(r, remaining);
  } else if (size === 'halfa4') {
    content.innerHTML = renderHalfA4(r, remaining);
  } else {
    content.innerHTML = renderDotMatrix(r, remaining);
  }
}

// Kirim tanda terima (PDF) via WhatsApp
async function waPdfReceipt() {
  if (!printData) return;
  const size = document.getElementById('print-size').value === 'halfa4' ? 'half' : 'a4';
  if (printData.sale_number) {
    await sendSaleWaPdf(printData, size);
    return;
  }
  try {
    const res = await fetch(`${API}/receipts/${printData.id}/wa-pdf?size=${size}`, {
      headers: { 'Authorization': 'Bearer ' + localStorage.getItem('token') }
    });
    if (!res.ok) throw new Error();
    const data = await res.json();
    const r = printData;
    const url = location.origin + data.url;
    const msg = `🧾 *Tanda Terima #${r.receipt_number}*\n\n`
      + `Pelanggan: ${r.customer_name || '-'}\n`
      + `Perangkat: ${[r.device_type, r.device_brand, r.device_model].filter(Boolean).join(' ') || '-'}\n`
      + `Keluhan: ${r.complaint || '-'}\n`
      + `Biaya: ${formatRupiah(r.estimated_cost)}\n`
      + (discountAmount(r) ? `Diskon: ${formatRupiah(discountAmount(r))}${r.discount_note ? ' (' + r.discount_note + ')' : ''}\n` : '')
      + `Status: ${statusLabel(r.status)}\n`
      + `Pembayaran: ${payText(r)}\n\n`
      + `📄 PDF tanda terima Anda (klik untuk membuka):\n${url}`;
    const wa = waPhone(r.customer_phone);
    if (wa) {
      window.open(`https://wa.me/${wa}?text=${encodeURIComponent(msg)}`, '_blank');
      showToast('WhatsApp dibuka dengan link PDF');
    } else {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        const ta = document.createElement('textarea');
        ta.value = url;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
      showToast('Pelanggan belum punya no. HP. Link PDF disalin.');
    }
  } catch (err) {
    showToast('Gagal membuat PDF via WhatsApp', 'error');
  }
}

// Kirim struk penjualan (PDF) via WhatsApp - jangan di-unduh, langsung buka WA
async function sendSaleWaPdf(sale, size) {
  try {
    const res = await fetch(`${API}/sales/${sale.id}/wa-pdf?size=${size}`, {
      headers: { 'Authorization': 'Bearer ' + localStorage.getItem('token') }
    });
    if (!res.ok) throw new Error();
    const data = await res.json();
    const url = location.origin + data.url;
    let items;
    try {
      items = JSON.parse(sale.items || '[]');
    } catch (e) {
      items = [];
    }
    const lines = items.length
      ? items.map(i => `- ${i.name} x${i.qty} @ ${formatRupiah(i.price)}`).join('\n')
      : '-';
    const disc = Number(sale.subtotal || 0) - Number(sale.total || 0);
    const msg = `🧾 *Nota Penjualan ${sale.sale_number}*\n\n`
      + `Pelanggan: ${sale.customer_name || '-'}\n`
      + (sale.customer_phone ? `HP: ${sale.customer_phone}\n` : '')
      + `Tanggal: ${sale.date || '-'}\n\n`
      + `Item:\n${lines}\n\n`
      + `Subtotal: ${formatRupiah(sale.subtotal)}\n`
      + (disc > 0 ? `Diskon: ${formatRupiah(disc)}\n` : '')
      + `Total: ${formatRupiah(sale.total)}\n`
      + `Dibayar: ${formatRupiah(sale.paid)}`
      + (sale.payment_status === 'hutang' ? ' (Hutang)' : '') + '\n'
      + (sale.due_date ? `Jatuh tempo: ${sale.due_date}\n` : '')
      + `\n📄 PDF struk Anda (klik untuk membuka):\n${url}`;
    const wa = waPhone(sale.customer_phone);
    if (wa) {
      window.open(`https://wa.me/${wa}?text=${encodeURIComponent(msg)}`, '_blank');
      showToast('WhatsApp dibuka dengan link PDF struk');
    } else {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        const ta = document.createElement('textarea');
        ta.value = url;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
      showToast('Pelanggan belum punya no. HP. Link PDF struk disalin.');
    }
  } catch (err) {
    showToast('Gagal membuat PDF struk via WhatsApp', 'error');
  }
}

function statusLabel(status) {
  return (status || 'diterima').charAt(0).toUpperCase() + (status || 'diterima').slice(1);
}

function renderDotMatrix(r, remaining) {
  return `
    <div class="receipt-header">
      ${logoHtml()}
      <h2>${settings.shop_name || 'Service Center'}</h2>
      <p>${settings.shop_address || ''}</p>
      <p>Telp: ${settings.shop_phone || '-'}</p>
    </div>

    <p><strong>No :</strong> ${r.receipt_number}</p>
    <p><strong>Tgl :</strong> ${formatDate(r.created_at)}</p>

    <hr class="receipt-divider">
    <p><strong>PELANGGAN</strong></p>
    <p>Nama : ${r.customer_name}</p>
    <p>Telp : ${r.customer_phone || '-'}</p>
    ${r.customer_address ? `<p>Almt : ${r.customer_address}</p>` : ''}

    <hr class="receipt-divider">
    <p><strong>DEVICE</strong></p>
    <p>${r.device_type || ''} ${r.device_brand || ''} ${r.device_model || ''}</p>
    ${r.device_serial ? `<p>S/N : ${r.device_serial}</p>` : ''}

    <hr class="receipt-divider">
    <p><strong>KELUHAN</strong></p>
    <p>${r.complaint || '-'}</p>
    ${r.notes ? `<p><strong>Catatan:</strong> ${r.notes}</p>` : ''}
    ${r.delivery_note ? `<p><strong>Keterangan Diantar:</strong> ${r.delivery_note}</p>` : ''}

    <hr class="receipt-divider">
    <div class="receipt-row">
      <span>Estimasi Biaya</span>
      <span>${formatRupiah(r.estimated_cost)}</span>
    </div>
    <div class="receipt-row">
      <span>Uang Muka (DP)</span>
      <span>${formatRupiah(r.down_payment)}</span>
    </div>
    ${discountAmount(r) ? `<div class="receipt-row">
      <span>Diskon${r.discount_note ? ' (' + r.discount_note + ')' : ''}</span>
      <span>${formatRupiah(discountAmount(r))}</span>
    </div>` : ''}
    <div class="receipt-row receipt-bold">
      <span>Sisa Bayar</span>
      <span>${formatRupiah(remaining)}</span>
    </div>

    <hr class="receipt-divider">
    <div class="receipt-row">
      <span>Status</span>
      <span class="receipt-bold">${statusLabel(r.status)}</span>
    </div>
    <div class="receipt-row">
      <span>Pembayaran</span>
      <span class="receipt-bold">${payText(r)}</span>
    </div>

    <hr class="receipt-divider">
    <div class="dotmatrix-sign">
      <div class="sign-left">
        <p>Diterima Oleh (Pelanggan)</p>
        <div class="sign-space"></div>
        <p>.......................</p>
      </div>
      <div class="sign-right">
        <p>Petugas / Teknisi</p>
        <div class="sign-space"></div>
        <p>.......................</p>
      </div>
    </div>

    <div class="dotmatrix-statement">
      <p>Barang yang diserahkan menjadi tanggung jawab service.<br>
      Barang lama/liquid yang ditinggalkan lebih dari 1 (satu) bulan dianggap hangus.</p>
    </div>

    <div class="receipt-footer">
      <p>${settings.shop_footer || 'Terima kasih atas kepercayaan Anda'}</p>
    </div>
  `;
}

function renderA4(r, remaining) {
  return `
    <div class="a4-header">
      <div class="a4-brand">
        ${logoHtml()}
        <h1>${settings.shop_name || 'Service Center'}</h1>
        <p>${settings.shop_address || ''}</p>
        <p>Telp: ${settings.shop_phone || '-'}</p>
      </div>
      <div class="a4-title">
        <h2>TANDA TERIMA SERVICE</h2>
        <p><strong>No:</strong> ${r.receipt_number}</p>
        <p><strong>Tanggal:</strong> ${formatDate(r.created_at)}</p>
      </div>
    </div>

    <table class="a4-table">
      <tr>
        <th>DATA PELANGGAN</th>
        <th>DATA PERANGKAT</th>
      </tr>
      <tr>
        <td>
          <div class="a4-field"><span>Nama:</span> <b>${r.customer_name}</b></div>
          <div class="a4-field"><span>Telepon:</span> ${r.customer_phone || '-'}</div>
          <div class="a4-field"><span>Alamat:</span> ${r.customer_address || '-'}</div>
        </td>
        <td>
          <div class="a4-field"><span>Jenis:</span> ${r.device_type || '-'}</div>
          <div class="a4-field"><span>Merek:</span> ${r.device_brand || '-'}</div>
          <div class="a4-field"><span>Model:</span> ${r.device_model || '-'}</div>
          <div class="a4-field"><span>S/N / IMEI:</span> ${r.device_serial || '-'}</div>
        </td>
      </tr>
      <tr>
        <th colspan="2">KELUHAN / KERUSAKAN</th>
      </tr>
      <tr>
        <td colspan="2" class="a4-cell-tall">${r.complaint || '-'}</td>
      </tr>
      <tr>
        <th colspan="2">CATATAN TEKNISI</th>
      </tr>
      <tr>
        <td colspan="2" class="a4-cell-mid">${r.notes || '-'}</td>
      </tr>
      ${r.delivery_note ? `
      <tr>
        <th colspan="2">KETERANGAN DIANTAR</th>
      </tr>
      <tr>
        <td colspan="2" class="a4-cell-mid">${r.delivery_note}</td>
      </tr>` : ''}
    </table>

    <div class="a4-cost">
      <div class="a4-cost-row"><span>Estimasi Biaya</span><span>${formatRupiah(r.estimated_cost)}</span></div>
      <div class="a4-cost-row"><span>Uang Muka (DP)</span><span>${formatRupiah(r.down_payment)}</span></div>
      ${discountAmount(r) ? `<div class="a4-cost-row"><span>Diskon${r.discount_note ? ' (' + r.discount_note + ')' : ''}</span><span>${formatRupiah(discountAmount(r))}</span></div>` : ''}
      <div class="a4-cost-row a4-total"><span>Sisa Bayar</span><span>${formatRupiah(remaining)}</span></div>
    </div>

    <div class="a4-status">
      <p>Status: <b>${statusLabel(r.status)}</b></p>
    </div>

    <div class="a4-status">
      <p>Pembayaran: <b>${payText(r)}</b></p>
    </div>

    <table class="a4-sign-table">
      <tr class="a4-sign-label">
        <td><span>Petugas / Teknisi</span></td>
        <td></td>
        <td><span>Diterima Oleh (Pelanggan)</span></td>
      </tr>
      <tr class="a4-sign-space">
        <td></td><td></td><td></td>
      </tr>
      <tr class="a4-sign-name">
        <td>( ..................... )</td>
        <td></td>
        <td>( ..................... )</td>
      </tr>
    </table>

    <div class="a4-footer">
      <p>${settings.shop_footer || 'Terima kasih atas kepercayaan Anda'}</p>
      <p class="a4-disclaimer">Barang lama/liquid yang ditinggalkan lebih dari 1 (satu) bulan dianggap hangus dan menjadi hak perusahaan.</p>
    </div>
  `;
}

function renderHalfA4(r, remaining) {
  return `
    <div class="half-header">
      <div>
        ${logoHtml()}
        <h1>${settings.shop_name || 'Service Center'}</h1>
        <p>${settings.shop_address || ''} ${settings.shop_phone ? '| Telp: ' + settings.shop_phone : ''}</p>
      </div>
      <div class="half-title">
        <h2>TANDA TERIMA SERVICE</h2>
        <p><strong>No:</strong> ${r.receipt_number}</p>
        <p><strong>Tanggal:</strong> ${formatDate(r.created_at)}</p>
      </div>
    </div>

    <table class="a4-table">
      <tr>
        <th colspan="2">DATA PELANGGAN</th>
      </tr>
      <tr>
        <td colspan="2">
          <div class="a4-field"><span>Nama:</span> <b>${r.customer_name}</b></div>
          <div class="a4-field"><span>Telepon:</span> ${r.customer_phone || '-'}</div>
          <div class="a4-field"><span>Alamat:</span> ${r.customer_address || '-'}</div>
        </td>
      </tr>
      <tr>
        <th colspan="2">DATA PERANGKAT</th>
      </tr>
      <tr>
        <td colspan="2">
          <div class="a4-field"><span>Jenis:</span> ${r.device_type || '-'}</div>
          <div class="a4-field"><span>Merek:</span> ${r.device_brand || '-'}</div>
          <div class="a4-field"><span>Model:</span> ${r.device_model || '-'}</div>
          <div class="a4-field"><span>S/N / IMEI:</span> ${r.device_serial || '-'}</div>
        </td>
      </tr>
      <tr>
        <th colspan="2">KELUHAN / KERUSAKAN</th>
      </tr>
      <tr>
        <td colspan="2" class="a4-cell-mid">${r.complaint || '-'}</td>
      </tr>
      ${r.notes ? `
      <tr>
        <th colspan="2">CATATAN TEKNISI</th>
      </tr>
      <tr>
        <td colspan="2" class="a4-cell-half">${r.notes}</td>
      </tr>` : ''}
      ${r.delivery_note ? `
      <tr>
        <th colspan="2">KETERANGAN DIANTAR</th>
      </tr>
      <tr>
        <td colspan="2" class="a4-cell-half">${r.delivery_note}</td>
      </tr>` : ''}
    </table>

    <div class="a4-cost">
      <div class="a4-cost-row"><span>Estimasi Biaya</span><span>${formatRupiah(r.estimated_cost)}</span></div>
      <div class="a4-cost-row"><span>Uang Muka (DP)</span><span>${formatRupiah(r.down_payment)}</span></div>
      ${discountAmount(r) ? `<div class="a4-cost-row"><span>Diskon${r.discount_note ? ' (' + r.discount_note + ')' : ''}</span><span>${formatRupiah(discountAmount(r))}</span></div>` : ''}
      <div class="a4-cost-row a4-total"><span>Sisa Bayar</span><span>${formatRupiah(remaining)}</span></div>
    </div>

    <div class="a4-status">
      <p>Status: <b>${statusLabel(r.status)}</b></p>
    </div>

    <div class="a4-status">
      <p>Pembayaran: <b>${payText(r)}</b></p>
    </div>

    <table class="a4-sign-table">
      <tr class="a4-sign-label">
        <td><span>Petugas / Teknisi</span></td>
        <td></td>
        <td><span>Diterima Oleh (Pelanggan)</span></td>
      </tr>
      <tr class="a4-sign-space">
        <td></td><td></td><td></td>
      </tr>
      <tr class="a4-sign-name">
        <td>( ..................... )</td>
        <td></td>
        <td>( ..................... )</td>
      </tr>
    </table>

    <div class="a4-footer">
      <p>${settings.shop_footer || 'Terima kasih atas kepercayaan Anda'}</p>
    </div>
  `;
}

function closePrint() {
  document.getElementById('print-preview').classList.remove('open');
  document.body.classList.remove('printing-dotmatrix', 'printing-halfa4', 'printing-a4');
  printData = null;
}

// ============ SETTINGS ============
async function loadSettings() {
  try {
    settings = await fetch(`${API}/settings`).then(r => r.json());
    document.getElementById('set-shop_name').value = settings.shop_name || '';
    document.getElementById('set-shop_address').value = settings.shop_address || '';
    document.getElementById('set-shop_phone').value = settings.shop_phone || '';
    document.getElementById('set-shop_footer').value = settings.shop_footer || '';
    const ul = document.getElementById('set-username-label');
    if (ul) ul.textContent = localStorage.getItem('shop_user') || '-';
    updateLogoPreview();
  } catch (err) {
    showToast('Gagal memuat pengaturan', 'error');
  }
}

function logoHtml() {
  return settings.shop_logo ? `<img src="${settings.shop_logo}" alt="logo" class="print-logo">` : '';
}

function updateLogoPreview() {
  const img = document.getElementById('logo-preview');
  if (settings.shop_logo) {
    img.src = settings.shop_logo;
    img.style.display = 'block';
  } else {
    img.src = '';
    img.style.display = 'none';
  }
}

document.getElementById('logo-upload').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const res = await fetch(`${API}/settings/logo`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + localStorage.getItem('token')
        },
        body: JSON.stringify({ data: reader.result, filename: file.name })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        showToast(err.error || 'Gagal mengunggah logo', 'error');
        return;
      }
      settings = await res.json();
      updateLogoPreview();
      showToast('Logo berhasil diunggah');
    } catch (err) {
      showToast('Gagal mengunggah logo', 'error');
    }
  };
  reader.readAsDataURL(file);
});

document.getElementById('logo-remove').addEventListener('click', async () => {
  try {
    await fetch(`${API}/settings/logo`, { method: 'DELETE' });
    settings.shop_logo = '';
    updateLogoPreview();
    document.getElementById('logo-upload').value = '';
    showToast('Logo berhasil dihapus');
  } catch (err) {
    showToast('Gagal menghapus logo', 'error');
  }
});

document.getElementById('settings-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await fetch(`${API}/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        shop_name: document.getElementById('set-shop_name').value,
        shop_address: document.getElementById('set-shop_address').value,
        shop_phone: document.getElementById('set-shop_phone').value,
        shop_footer: document.getElementById('set-shop_footer').value
      })
    });
    showToast('Pengaturan berhasil disimpan');
  } catch (err) {
    showToast('Gagal menyimpan pengaturan', 'error');
  }
});

// ============ LOGIN / PASSWORD ============
document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  const errEl = document.getElementById('login-error');
  errEl.textContent = '';
  if (!username || !password) {
    errEl.textContent = 'Username dan password wajib diisi';
    return;
  }
  try {
    const res = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!res.ok) {
      errEl.textContent = data.error || 'Login gagal';
      return;
    }
    setToken(data.token);
    if (data.username) localStorage.setItem('shop_user', data.username);
    if (data.shopName) document.getElementById('nav-brand').textContent = data.shopName;
    hideLogin();
    showApp();
    if (data.subscription) renderSubBanner(data.subscription);
    loadDashboard();
    showToast('Berhasil masuk, selamat datang ' + (data.username || ''));
  } catch (err) {
    errEl.textContent = 'Terjadi kesalahan. Coba lagi.';
  }
});

document.getElementById('btn-logout').addEventListener('click', (e) => {
  e.preventDefault();
  fetch(`${API}/auth/logout`, { method: 'POST' }).catch(() => {});
  setToken(null);
  localStorage.removeItem('shop_user');
  document.getElementById('btn-logout').style.display = 'none';
  document.getElementById('sub-banner').style.display = 'none';
  document.getElementById('sub-overlay').style.display = 'none';
  showLogin();
});

// ============ SUBSCRIPTION / BILLING ============
function fmtDate(s) {
  if (!s) return '-';
  const d = new Date(s.replace(' ', 'T'));
  return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' });
}

function daysLeft(endIso) {
  const d = new Date(endIso.replace(' ', 'T'));
  return Math.ceil((d.getTime() - Date.now()) / 86400000);
}

function renderSubBanner(sub) {
  const el = document.getElementById('sub-banner');
  if (!sub) { el.style.display = 'none'; return; }
  let html = '', cls = 'sub-banner';
  const price = 'Rp ' + Number(sub.price || 0).toLocaleString('id-ID');
  if (sub.effective_status === 'trial') {
    const dl = daysLeft(sub.trial_end);
    cls += ' trial';
    html = `🎁 <b>Masa coba gratis:</b> sisa <b>${dl}</b> hari (sampai ${fmtDate(sub.trial_end)}). Setelah itu ${price}/bulan untuk lanjut pakai.`;
  } else if (sub.effective_status === 'active') {
    const dl = daysLeft(sub.sub_end);
    cls += ' active';
    html = `✅ <b>Langganan aktif</b> sampai ${fmtDate(sub.sub_end)} (sisa ${dl} hari).`;
  } else if (sub.effective_status === 'expired') {
    cls += ' danger';
    html = `⚠️ <b>Masa langganan habis.</b> Data terkunci sampai diperpanjang (${price}/bulan).`;
  } else if (sub.effective_status === 'suspended') {
    cls += ' danger';
    html = `⛔ <b>Akun dinonaktifkan.</b> Hubungi admin untuk info lebih lanjut.`;
  }
  el.className = cls;
  el.innerHTML = html + ` <a href="#" onclick="openSubOverlay(); return false;" class="sub-btn">Bayar / Detail</a>`;
  el.style.display = 'block';
}

async function loadSubscription(forceOpen) {
  try {
    const res = await fetch(`${API}/auth/check`);
    if (!res.ok) return;
    const data = await res.json();
    if (data.subscription) renderSubBanner(data.subscription);
    if (data.subscription && data.subscription.effective_status === 'expired') {
      openSubOverlay();
    } else if (forceOpen) {
      openSubOverlay();
    }
  } catch (e) {}
}

function openSubOverlay() {
  document.getElementById('sub-overlay').style.display = 'flex';
  document.getElementById('sub-form').reset();
  document.getElementById('sub-msg').textContent = '';
  fetch(`${API}/subscription`).then(r => r.json()).then(s => {
    if (!s) return;
    const price = 'Rp ' + Number(s.price || 0).toLocaleString('id-ID');
    const bank = document.getElementById('sub-bank');
    const bankHtml = s.bank_name || s.bank_account
      ? `<div class="sub-bank-row"><b>${s.bank_name || ''}</b> · ${s.bank_account || ''} a.n. ${s.bank_holder || ''}</div>`
      : '';
    document.getElementById('sub-desc').innerHTML = `Perpanjang langganan <b>${price}</b>/bulan.` +
      (s.effective_status === 'trial'
        ? ` Masa coba Anda berakhir ${fmtDate(s.trial_end)}.`
        : s.effective_status === 'expired'
          ? ' Masa langganan Anda habis.'
          : s.effective_status === 'suspended'
            ? ' Akun Anda dinonaktifkan admin.'
            : '');
    const qrisWrap = document.getElementById('sub-qris-wrap');
    const qrisImg = document.getElementById('sub-qris');
    if (s.effective_status === 'suspended') {
      document.getElementById('sub-form').style.display = 'none';
      bank.style.display = 'none';
      qrisWrap.style.display = 'none';
    } else {
      document.getElementById('sub-form').style.display = '';
      bank.style.display = bankHtml ? '' : 'none';
      bank.innerHTML = bankHtml;
      if (s.qris_image) {
        qrisImg.src = s.qris_image;
        qrisWrap.style.display = '';
      } else {
        qrisWrap.style.display = 'none';
      }
    }
  }).catch(() => {});
}

function closeSubOverlay() {
  document.getElementById('sub-overlay').style.display = 'none';
}

document.getElementById('sub-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = document.getElementById('sub-msg');
  msg.textContent = '';
  const file = document.getElementById('sub-proof').files[0];
  if (!file) { msg.textContent = 'Upload bukti transfer dulu (PNG/JPG)'; return; }
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const res = await fetch(`${API}/subscription/pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: document.getElementById('sub-note').value, proof: reader.result })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { msg.textContent = data.error || 'Gagal mengirim bukti'; return; }
      msg.style.color = '#16a34a';
      msg.textContent = 'Bukti terkirim! Menunggu konfirmasi admin (maks. 1x24 jam).';
      document.getElementById('sub-form').reset();
      setTimeout(closeSubOverlay, 1500);
    } catch (err) {
      msg.textContent = 'Terjadi kesalahan. Coba lagi.';
    }
  };
  reader.readAsDataURL(file);
});

document.getElementById('password-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const current = document.getElementById('set-current').value;
  const p1 = document.getElementById('set-password').value;
  const p2 = document.getElementById('set-password-confirm').value;

  if (!current || !p1) {
    showToast('Isi password lama dan baru', 'error');
    return;
  }
  if (p1 !== p2) {
    showToast('Konfirmasi password tidak cocok', 'error');
    return;
  }

  try {
    const res = await fetch(`${API}/auth/password`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ current, password: p1 })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Gagal');
    document.getElementById('set-current').value = '';
    document.getElementById('set-password').value = '';
    document.getElementById('set-password-confirm').value = '';
    showToast('Password berhasil diganti');
  } catch (err) {
    showToast(err.message || 'Gagal mengganti password', 'error');
  }
});

// ============ REPORT ============
let rptGroupBy = null;

document.getElementById('rpt-search').addEventListener('click', loadReport);

document.getElementById('rpt-group-toggle').addEventListener('click', () => {
  rptGroupBy = rptGroupBy === 'date' ? null : 'date';
  document.getElementById('rpt-group-toggle').textContent =
    rptGroupBy === 'date' ? 'Tampilkan Detail' : 'Tampilkan per Hari';
  loadReport();
});

async function loadReport() {
  const from = document.getElementById('rpt-from').value;
  const to = document.getElementById('rpt-to').value;
  const status = document.getElementById('rpt-status').value;
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  if (status && status !== 'semua') params.set('status', status);
  if (rptGroupBy) params.set('groupBy', rptGroupBy);

  try {
    const data = await fetch(`${API}/report?${params}`).then(r => r.json());
    const s = data.summary;
    document.getElementById('rpt-stats').innerHTML = `
      <div class="stat-card blue">
        <div class="stat-value">${s.count}</div>
        <div class="stat-label">Total Transaksi</div>
      </div>
      <div class="stat-card green">
        <div class="stat-value">${formatRupiah(s.total_estimate)}</div>
        <div class="stat-label">Total Estimasi</div>
      </div>
      <div class="stat-card purple">
        <div class="stat-value">${formatRupiah(s.total_discount || 0)}</div>
        <div class="stat-label">Total Diskon</div>
      </div>
      <div class="stat-card teal">
        <div class="stat-value">${formatRupiah(s.total_dp)}</div>
        <div class="stat-label">Total DP Diterima</div>
      </div>
      <div class="stat-card orange">
        <div class="stat-value">${formatRupiah(s.total_remaining)}</div>
        <div class="stat-label">Sisa Belum Dibayar</div>
      </div>
    `;

    const thead = document.getElementById('rpt-thead');
    const tbody = document.getElementById('rpt-tbody');

    if (rptGroupBy === 'date') {
      thead.innerHTML = '<tr><th>Tanggal</th><th>Jumlah</th><th>Total Estimasi</th><th>Total Diskon</th><th>Total DP</th></tr>';
      if (data.detail.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="empty-state"><p>Tidak ada data</p></td></tr>';
        return;
      }
      tbody.innerHTML = data.detail.map(d => `
        <tr>
          <td>${d.tanggal}</td>
          <td>${d.count}</td>
          <td>${formatRupiah(d.total_estimate)}</td>
          <td>${formatRupiah(d.total_discount || 0)}</td>
          <td>${formatRupiah(d.total_dp)}</td>
        </tr>
      `).join('');
    } else {
      thead.innerHTML = '<tr><th>No. Receipt</th><th>Pelanggan</th><th>Tanggal</th><th>Estimasi</th><th>Diskon</th><th>DP</th><th>Pembayaran</th><th>Status</th></tr>';
      if (data.detail.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="empty-state"><p>Tidak ada data</p></td></tr>';
        return;
      }
      tbody.innerHTML = data.detail.map(r => `
        <tr>
          <td><strong>${r.receipt_number}</strong></td>
          <td>${r.customer_name}</td>
          <td>${formatDate(r.created_at)}</td>
          <td>${formatRupiah(r.estimated_cost)}</td>
          <td>${formatRupiah(discountAmount(r))}</td>
          <td>${formatRupiah(r.down_payment)}</td>
          <td>${paymentBadge(r)}</td>
          <td>${statusBadge(r.status)}</td>
        </tr>
      `).join('');
    }
  } catch (err) {
    showToast('Gagal memuat laporan', 'error');
  }
}

// ============ KASIR / TOKO ============
let kasirTab = 'kasir';
let kasirProducts = [];
let cartArr = [];

function saleDiscountAmount(subtotal, type, val) {
  const s = Number(subtotal) || 0;
  const v = Number(val) || 0;
  if (type === 'percent') return Math.round(s * v / 100);
  if (type === 'rp') return Math.round(v);
  return 0;
}

function salePayText(s) {
  if ((s.payment_status || '') === 'hutang') {
    return 'Hutang' + (s.due_date ? ' · jatuh tempo ' + fmtDateStr(s.due_date) : '');
  }
  const m = settleLabel(s.settle_method);
  return 'Lunas' + (m ? ' · ' + m : '') + (s.settle_date ? ' · ' + fmtDateStr(s.settle_date) : '');
}

function parseSaleItems(s) {
  try { return JSON.parse(s.items || '[]'); } catch (e) { return []; }
}

function saleItemsLabel(s) {
  return parseSaleItems(s).map(it => it.name).join(', ') || '-';
}

function switchKasirTab(tab) {
  kasirTab = tab;
  document.querySelectorAll('#kasir-tabs .tab-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.tab === tab));
  document.getElementById('ktab-kasir').style.display = tab === 'kasir' ? '' : 'none';
  document.getElementById('ktab-produk').style.display = tab === 'produk' ? '' : 'none';
  document.getElementById('ktab-riwayat').style.display = tab === 'riwayat' ? '' : 'none';
  if (tab === 'produk') loadKasirProducts();
  if (tab === 'riwayat') loadSales();
}

document.querySelectorAll('#kasir-tabs .tab-btn').forEach(btn => {
  btn.addEventListener('click', () => switchKasirTab(btn.dataset.tab));
});

function saleRupiahToolbar() {
  const input = document.getElementById('cart-paid');
  if (input.value !== '' && input.value !== '0') {
    input.value = input.value.replace(/\D/g, '').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }
}

function renderKasirProducts(list) {
  const tbody = document.querySelector('#kasir-product-table tbody');
  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-state"><p>Tidak ada produk. Tambah produk di tab Produk.</p></td></tr>`;
    return;
  }
  tbody.innerHTML = list.map(p => `
    <tr>
      <td>${escapeHtml(p.name)}<br><small class="prop-sub">${escapeHtml(p.category || '')}</small></td>
      <td>${formatRupiah(p.price)}</td>
      <td>${p.stock}</td>
      <td><input type="number" min="1" value="1" class="k-qty" id="k-qty-${p.id}" style="width:58px"></td>
      <td><button class="btn btn-sm btn-primary" onclick="addToCart(${p.id})">+ Tambah</button></td>
    </tr>
  `).join('');
}

function addToCart(pid) {
  const p = kasirProducts.find(x => x.id === pid);
  if (!p) return;
  const qtyEl = document.getElementById(`k-qty-${pid}`);
  let qty = parseInt(qtyEl.value, 10);
  if (!qty || qty < 1) qty = 1;
  if (p.stock !== null && p.stock !== undefined && Number(p.stock) < qty) {
    showToast('Stok tidak cukup', 'error');
    return;
  }
  const existing = cartArr.find(c => c.client_id === p.client_id);
  if (existing) {
    existing.qty += qty;
  } else {
    cartArr.push({
      client_id: p.client_id,
      name: p.name,
      qty: qty,
      price: Number(p.price) || 0,
      hpp: Number(p.hpp) || 0
    });
  }
  renderCart();
}

function renderCart() {
  const tbody = document.querySelector('#cart-table tbody');
  if (!cartArr.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="empty-state"><p>Keranjang kosong</p></td></tr>`;
  } else {
    tbody.innerHTML = cartArr.map((it, i) => `
      <tr>
        <td>${escapeHtml(it.name)}</td>
        <td>${it.qty}</td>
        <td>${formatRupiah(it.qty * it.price)}</td>
        <td><button class="btn btn-sm btn-danger" onclick="rmCartItem(${i})">🗑️</button></td>
      </tr>
    `).join('');
  }
  updateCartTotals();
}

function rmCartItem(i) {
  cartArr.splice(i, 1);
  renderCart();
}

function updateCartTotals() {
  const subtotal = cartArr.reduce((s, it) => s + it.qty * it.price, 0);
  const type = document.getElementById('cart-discount_type').value;
  const val = parseRupiah(document.getElementById('cart-discount_value').value);
  const disc = saleDiscountAmount(subtotal, type, val);
  const total = Math.max(0, subtotal - disc);
  document.getElementById('cart-subtotal').textContent = formatRupiah(subtotal);
  document.getElementById('cart-total').textContent = formatRupiah(total);
  document.getElementById('cart-discount-note-wrap').style.display = disc && document.getElementById('cart-discount_type').value !== '' ? '' : 'none';
  const paid = parseRupiah(document.getElementById('cart-paid').value);
  const method = document.getElementById('cart-method').value;
  if (method !== 'hutang') {
    const change = paid >= total ? paid - total : 0;
    document.getElementById('cart-change').value = change ? numId(change) : '';
  } else {
    document.getElementById('cart-change').value = '';
  }
}

document.getElementById('cart-discount_type').addEventListener('change', updateCartTotals);
document.getElementById('cart-discount_value').addEventListener('input', debounce(updateCartTotals, 120));
document.getElementById('cart-paid').addEventListener('input', debounce(() => { saleRupiahToolbar(); updateCartTotals(); }, 120));

document.getElementById('cart-method').addEventListener('change', () => {
  const m = document.getElementById('cart-method').value;
  document.getElementById('cart-paid-group').style.display = m === 'hutang' ? 'none' : '';
  document.getElementById('cart-due-group').style.display = m === 'hutang' ? '' : 'none';
  updateCartTotals();
});

async function saveSale() {
  if (!cartArr.length) {
    showToast('Keranjang masih kosong', 'error');
    return;
  }
  const method = document.getElementById('cart-method').value;
  const subtotal = cartArr.reduce((s, it) => s + it.qty * it.price, 0);
  const discType = document.getElementById('cart-discount_type').value;
  const discVal = parseRupiah(document.getElementById('cart-discount_value').value);
  const disc = saleDiscountAmount(subtotal, discType, discVal);
  const totalNet = subtotal - disc;
  const paid = method === 'hutang' ? 0 : parseRupiah(document.getElementById('cart-paid').value);
  if (method !== 'hutang' && paid < totalNet) {
    showToast('Uang diterima kurang dari total', 'error');
    return;
  }
  const due = document.getElementById('cart-due').value;

  const body = {
    items: cartArr.map(it => ({
      client_id: it.client_id,
      name: it.name,
      qty: it.qty,
      price: it.price,
      hpp: it.hpp || 0
    })),
    customer_name: document.getElementById('cart-customer').value,
    customer_phone: document.getElementById('cart-phone').value,
    discount_type: discType,
    discount_value: discVal,
    discount_note: document.getElementById('cart-discount_note').value,
    payment_status: method === 'hutang' ? 'hutang' : 'lunas',
    settle_method: method === 'hutang' ? 'cash' : method,
    paid: paid,
    due_date: method === 'hutang' ? due : ''
  };

  try {
    const res = await fetch(`${API}/sales`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Gagal simpan');
    }
    const sale = await res.json();
    showToast('Penjualan berhasil: ' + sale.sale_number);
    cartArr = [];
    renderCart();
    document.getElementById('cart-customer').value = '';
    document.getElementById('cart-phone').value = '';
    document.getElementById('cart-discount_type').value = '';
    document.getElementById('cart-discount_value').value = '0';
    document.getElementById('cart-discount_note').value = '';
    document.getElementById('cart-paid').value = '0';
    document.getElementById('cart-due').value = '';
    await loadKasirProducts();
    printSale(sale.id);
  } catch (err) {
    showToast(err.message || 'Gagal menyimpan penjualan', 'error');
  }
}

document.getElementById('btn-save-sale').addEventListener('click', saveSale);

// ---------- Produk ----------
async function loadKasirProducts() {
  const search = document.getElementById('kasir-search').value;
  const params = new URLSearchParams();
  if (search) params.set('search', search);
  try {
    const list = await fetch(`${API}/products?${params}`).then(r => r.json());
    kasirProducts = list;
    renderKasirProducts(list);
    renderProdukTable(list);
  } catch (err) {
    showToast('Gagal memuat produk', 'error');
  }
}

function renderProdukTable(list) {
  const tbody = document.querySelector('#produk-table tbody');
  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state"><p>Belum ada produk</p></td></tr>`;
    return;
  }
  tbody.innerHTML = list.map(p => `
    <tr>
      <td><strong>${escapeHtml(p.name)}</strong></td>
      <td>${escapeHtml(p.category || '-')}</td>
      <td>${formatRupiah(p.price)}</td>
      <td>${formatRupiah(p.hpp || 0)}</td>
      <td>${p.stock}</td>
      <td>
        <div class="btn-group">
          <button class="btn btn-sm btn-secondary" onclick="editProduk(${p.id})">✏️</button>
          <button class="btn btn-sm btn-success" onclick="stockProduk(${p.id})">🏷️ Stok</button>
          <button class="btn btn-sm btn-danger" onclick="deleteProduk(${p.id})">🗑️</button>
        </div>
      </td>
    </tr>
  `).join('');
}

function resetProdukForm() {
  document.getElementById('produk-id').value = '';
  document.getElementById('produk-name').value = '';
  document.getElementById('produk-category').value = '';
  document.getElementById('produk-price').value = '0';
  document.getElementById('produk-hpp').value = '0';
  document.getElementById('produk-stock').value = '0';
  document.getElementById('produk-form-title').textContent = 'Tambah Produk';
  document.getElementById('produk-reset').style.display = 'none';
}

async function saveProduk() {
  const name = document.getElementById('produk-name').value.trim();
  if (!name) { showToast('Nama produk wajib diisi', 'error'); return; }
  const id = document.getElementById('produk-id').value;
  const body = {
    name: name,
    category: document.getElementById('produk-category').value.trim(),
    price: parseRupiah(document.getElementById('produk-price').value),
    hpp: parseRupiah(document.getElementById('produk-hpp').value),
    stock: parseRupiah(document.getElementById('produk-stock').value)
  };
  try {
    const res = await fetch(`${API}/products${id ? '/' + id : ''}`, {
      method: id ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error();
    showToast(id ? 'Produk berhasil diupdate' : 'Produk berhasil ditambahkan');
    resetProdukForm();
    loadKasirProducts();
  } catch (err) {
    showToast('Gagal menyimpan produk', 'error');
  }
}

function editProduk(id) {
  const p = kasirProducts.find(x => x.id === id);
  if (!p) return;
  switchKasirTab('produk');
  document.getElementById('produk-id').value = p.id;
  document.getElementById('produk-name').value = p.name;
  document.getElementById('produk-category').value = p.category || '';
  document.getElementById('produk-price').value = numId(p.price);
  document.getElementById('produk-hpp').value = numId(p.hpp || 0);
  document.getElementById('produk-stock').value = numId(p.stock);
  document.getElementById('produk-form-title').textContent = 'Edit Produk';
  document.getElementById('produk-reset').style.display = '';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function stockProduk(id) {
  const p = kasirProducts.find(x => x.id === id);
  if (!p) return;
  const val = prompt('Stok baru untuk "' + p.name + '" (saat ini ' + p.stock + '):', String(p.stock));
  if (val === null) return;
  const n = Math.max(0, parseInt(String(val).replace(/[^\d]/g, ''), 10) || 0);
  try {
    const res = await fetch(`${API}/products/${id}/stock`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stock: n })
    });
    if (!res.ok) throw new Error();
    showToast('Stok diperbarui');
    loadKasirProducts();
  } catch (err) {
    showToast('Gagal memperbarui stok', 'error');
  }
}

async function deleteProduk(id) {
  if (!confirm('Yakin ingin menghapus produk ini?')) return;
  try {
    await fetch(`${API}/products/${id}`, { method: 'DELETE' });
    showToast('Produk dihapus');
    loadKasirProducts();
  } catch (err) {
    showToast('Gagal menghapus produk', 'error');
  }
}

document.getElementById('produk-save').addEventListener('click', saveProduk);
document.getElementById('produk-reset').addEventListener('click', resetProdukForm);
document.getElementById('kasir-search').addEventListener('input', debounce(() => loadKasirProducts(), 300));

// ---------- Riwayat Jualan ----------
async function loadSales() {
  const from = document.getElementById('sale-from').value;
  const to = document.getElementById('sale-to').value;
  const search = document.getElementById('sale-search').value;
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  if (search) params.set('search', search);
  try {
    const sales = await fetch(`${API}/sales?${params}`).then(r => r.json());
    const tbody = document.querySelector('#sales-table tbody');
    if (!sales.length) {
      tbody.innerHTML = `<tr><td colspan="9" class="empty-state"><p>Tidak ada penjualan</p></td></tr>`;
      document.getElementById('sale-summary').innerHTML = '';
    } else {
      tbody.innerHTML = sales.map(s => `
        <tr>
          <td><strong>${s.sale_number}</strong></td>
          <td>${fmtDateStr(s.date)}</td>
          <td>${escapeHtml(s.customer_name || '-')}</td>
          <td title="${escapeHtml(saleItemsLabel(s))}">${truncate(saleItemsLabel(s), 40)}</td>
          <td>${formatRupiah(s.total)}</td>
          <td>${formatRupiah(s.laba ?? 0)}</td>
          <td>${formatRupiah(s.paid)}</td>
          <td>${salePayText(s)}</td>
          <td>
            <div class="btn-group">
              <button class="btn btn-sm btn-success" onclick="printSale(${s.id})">🖨️</button>
              <button class="btn btn-sm btn-primary" onclick="exportSalePdf(${s.id},'a4')">📄 A4</button>
              <button class="btn btn-sm btn-secondary" onclick="exportSalePdf(${s.id},'half')">📄 ½A4</button>
              <button class="btn btn-sm btn-danger" onclick="deleteSale(${s.id})">🗑️</button>
            </div>
          </td>
        </tr>
      `).join('');
      const totSub = sales.reduce((s, x) => s + Number(x.total || 0), 0);
      const totPaid = sales.reduce((s, x) => s + Number(x.paid || 0), 0);
      const totLaba = sales.reduce((s, x) => s + Number(x.laba ?? 0), 0);
      const totOut = sales.reduce((s, x) => s + ((x.payment_status === 'hutang') ? (Number(x.total || 0) - Number(x.paid || 0)) : 0), 0);
      const margin = totSub > 0 ? Math.round(totLaba * 100 / totSub * 10) / 10 : 0;
      document.getElementById('sale-summary').innerHTML = `
        <div class="stat-card blue"><div class="stat-value">${sales.length}</div><div class="stat-label">Transaksi</div></div>
        <div class="stat-card teal"><div class="stat-value">${formatRupiah(totSub)}</div><div class="stat-label">Total Penjualan</div></div>
        <div class="stat-card green"><div class="stat-value">${formatRupiah(totLaba)}</div><div class="stat-label">Laba Kotor</div></div>
        <div class="stat-card cyan"><div class="stat-value">${margin.toLocaleString('id-ID', { maximumFractionDigits: 1 })}%</div><div class="stat-label">Margin</div></div>
        <div class="stat-card orange"><div class="stat-value">${formatRupiah(totPaid)}</div><div class="stat-label">Total Diterima</div></div>
        <div class="stat-card red"><div class="stat-value">${formatRupiah(totOut)}</div><div class="stat-label">Sisa Hutang</div></div>
      `;
    }
  } catch (err) {
    showToast('Gagal memuat riwayat jualan', 'error');
  }
}

document.getElementById('sale-filter-btn').addEventListener('click', loadSales);

async function printSale(id) {
  try {
    const s = await fetch(`${API}/sales/${id}`).then(r => r.json());
    const conf = await fetch(`${API}/settings`).then(r => r.json());
    settings = conf;
    printData = s;
    document.getElementById('print-size').value = 'dotmatrix';
    renderPrint();
    document.getElementById('print-preview').classList.add('open');
  } catch (err) {
    showToast('Gagal memuat data cetak', 'error');
  }
}

async function exportSalePdf(id, format) {
  const path = format === 'half' ? `${API}/sales/${id}/export/half` : `${API}/sales/${id}/export`;
  try {
    const res = await fetch(path, {
      headers: { 'Authorization': 'Bearer ' + localStorage.getItem('token') }
    });
    if (!res.ok) throw new Error();
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const s = await fetch(`${API}/sales/${id}`, { headers: { 'Authorization': 'Bearer ' + localStorage.getItem('token') } }).then(x => x.json());
    a.download = `${s.sale_number}${format === 'half' ? '-half' : ''}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
    showToast('PDF struk berhasil diunduh');
  } catch (err) {
    showToast('Gagal export PDF', 'error');
  }
}

async function deleteSale(id) {
  if (!confirm('Yakin ingin menghapus penjualan ini?')) return;
  try {
    await fetch(`${API}/sales/${id}`, { method: 'DELETE' });
    showToast('Penjualan dihapus');
    loadSales();
  } catch (err) {
    showToast('Gagal menghapus penjualan', 'error');
  }
}

// ---------- Printable Struk Kasir ----------
function renderSaleDotMatrix(s) {
  const items = parseSaleItems(s);
  const disc = saleDiscountAmount(s.subtotal, s.discount_type, s.discount_value);
  return `
    <div class="receipt-header">
      ${logoHtml()}
      <h2>${settings.shop_name || 'Toko'}</h2>
      <p>${settings.shop_address || ''}</p>
      <p>Telp: ${settings.shop_phone || '-'}</p>
    </div>

    <p><strong>No :</strong> ${s.sale_number}</p>
    <p><strong>Tgl :</strong> ${fmtDateStr(s.date || s.created_at)}</p>

    <hr class="receipt-divider">
    <p><strong>PELANGGAN</strong></p>
    <p>Nama : ${s.customer_name || '-'}</p>
    <p>Telp : ${s.customer_phone || '-'}</p>

    <hr class="receipt-divider">
    <p><strong>ITEM</strong></p>
    ${items.map(it => `<div class="receipt-row">
      <span>${it.qty} x ${it.name}</span>
      <span>${formatRupiah(it.qty * it.price)}</span>
    </div>`).join('')}

    <hr class="receipt-divider">
    <div class="receipt-row"><span>Subtotal</span><span>${formatRupiah(s.subtotal)}</span></div>
    ${disc ? `<div class="receipt-row"><span>Diskon${s.discount_note ? ' (' + s.discount_note + ')' : ''}</span><span>${formatRupiah(disc)}</span></div>` : ''}
    <div class="receipt-row receipt-bold"><span>Total</span><span>${formatRupiah(s.total)}</span></div>
    <div class="receipt-row"><span>Dibayar</span><span>${formatRupiah(s.paid)}</span></div>
    ${Number(s.change_amount) > 0 ? `<div class="receipt-row"><span>Kembalian</span><span>${formatRupiah(s.change_amount)}</span></div>` : ''}
    ${(s.payment_status || '') === 'hutang' ? `<div class="receipt-row receipt-bold"><span>Sisa Hutang</span><span>${formatRupiah(Number(s.total) - Number(s.paid))}</span></div>` : ''}

    <hr class="receipt-divider">
    <div class="receipt-row">
      <span>Pembayaran</span>
      <span class="receipt-bold">${salePayText(s)}</span>
    </div>

    <hr class="receipt-divider">
    <div class="dotmatrix-sign">
      <div class="sign-left">
        <p>Pembeli</p>
        <div class="sign-space"></div>
        <p>.......................</p>
      </div>
      <div class="sign-right">
        <p>Petugas / Kasir</p>
        <div class="sign-space"></div>
        <p>.......................</p>
      </div>
    </div>

    <div class="receipt-footer">
      <p>${settings.shop_footer || 'Terima kasih'}</p>
    </div>
  `;
}

function renderSaleA4(s) {
  return `
    <div class="a4-header">
      <div class="a4-brand">
        ${logoHtml()}
        <h1>${settings.shop_name || 'Toko'}</h1>
        <p>${settings.shop_address || ''}</p>
        <p>Telp: ${settings.shop_phone || '-'}</p>
      </div>
      <div class="a4-title">
        <h2>STRUK PENJUALAN</h2>
        <p><strong>No:</strong> ${s.sale_number}</p>
        <p><strong>Tanggal:</strong> ${fmtDateStr(s.date || s.created_at)}</p>
      </div>
    </div>
    ${renderSaleA4Body(s)}
  `;
}

function renderSaleA4Body(s) {
  const items = parseSaleItems(s);
  const disc = saleDiscountAmount(s.subtotal, s.discount_type, s.discount_value);
  return `
    <table class="a4-table">
      <tr><th colspan="2">DATA PELANGGAN</th></tr>
      <tr>
        <td colspan="2">
          <div class="a4-field"><span>Nama:</span> <b>${s.customer_name || '-'}</b></div>
          <div class="a4-field"><span>Telepon:</span> ${s.customer_phone || '-'}</div>
        </td>
      </tr>
      <tr><th colspan="2">RINCIAN BARANG</th></tr>
      <tr>
        <td colspan="2">
          ${items.map(it => `<div class="a4-field"><span>${it.qty} x ${escapeHtml(it.name)}:</span> <b>${formatRupiah(it.qty * it.price)}</b></div>`).join('')}
        </td>
      </tr>
    </table>

    <div class="a4-cost">
      <div class="a4-cost-row"><span>Subtotal</span><span>${formatRupiah(s.subtotal)}</span></div>
      ${disc ? `<div class="a4-cost-row"><span>Diskon${s.discount_note ? ' (' + s.discount_note + ')' : ''}</span><span>${formatRupiah(disc)}</span></div>` : ''}
      <div class="a4-cost-row a4-total"><span>Total</span><span>${formatRupiah(s.total)}</span></div>
      <div class="a4-cost-row"><span>Dibayar</span><span>${formatRupiah(s.paid)}</span></div>
      ${Number(s.change_amount) > 0 ? `<div class="a4-cost-row"><span>Kembalian</span><span>${formatRupiah(s.change_amount)}</span></div>` : ''}
      ${(s.payment_status || '') === 'hutang' ? `<div class="a4-cost-row a4-total"><span>Sisa Hutang</span><span>${formatRupiah(Number(s.total) - Number(s.paid))}</span></div>` : ''}
    </div>

    <div class="a4-status"><p>Pembayaran: <b>${salePayText(s)}</b></p></div>

    <table class="a4-sign-table">
      <tr class="a4-sign-label">
        <td><span>Petugas / Kasir</span></td>
        <td></td>
        <td><span>Pembeli</span></td>
      </tr>
      <tr class="a4-sign-space"><td></td><td></td><td></td></tr>
      <tr class="a4-sign-name">
        <td>( ..................... )</td>
        <td></td>
        <td>( ..................... )</td>
      </tr>
    </table>

    <div class="a4-footer">
      <p>${settings.shop_footer || 'Terima kasih'}</p>
    </div>
  `;
}

function renderSaleHalfA4(s) {
  return `<div class="half-header" style="margin-bottom:10px">
      <div>
        ${logoHtml()}
        <h1>${settings.shop_name || 'Toko'}</h1>
        <p>${settings.shop_address || ''} ${settings.shop_phone ? '| Telp: ' + settings.shop_phone : ''}</p>
      </div>
      <div class="half-title">
        <h2>STRUK PENJUALAN</h2>
        <p><strong>No:</strong> ${s.sale_number}</p>
        <p><strong>Tanggal:</strong> ${fmtDateStr(s.date || s.created_at)}</p>
      </div>
    </div>
    ${renderSaleA4Body(s)}`;
}

// ============ INIT ============
async function init() {
  const token = getToken();
  if (!token) {
    showLogin();
    return;
  }
  try {
    const res = await fetch(`${API}/auth/check`);
    if (res.ok) {
      const data = await res.json();
      if (data.shopName) document.getElementById('nav-brand').textContent = data.shopName;
      localStorage.setItem('shop_user', data.username || '');
      if (data.subscription) renderSubBanner(data.subscription);
      showApp();
      hideLogin();
      if (data.subscription && (data.subscription.effective_status === 'expired' || data.subscription.effective_status === 'suspended')) {
        loadDashboard();
        openSubOverlay();
      } else {
        loadDashboard();
      }
    } else {
      setToken(null);
      showLogin();
    }
  } catch (err) {
    showLogin();
  }
}

init();
