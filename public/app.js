const API = '/api';
let settings = {};
let currentPage = 'dashboard';

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
    if (page === 'report') loadReport();
    if (page === 'settings') loadSettings();
  });
});

// Format currency
function formatRupiah(n) {
  return 'Rp ' + Number(n || 0).toLocaleString('id-ID');
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
    diambil: 'Diambil',
    batal: 'Batal'
  };
  return `<span class="status-badge status-${status}">${labels[status] || status}</span>`;
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
      <div class="stat-card red">
        <div class="stat-value">${stats.batal || 0}</div>
        <div class="stat-label">Batal</div>
      </div>
      <div class="stat-card red">
        <div class="stat-value">${formatRupiah(stats.todayRevenue)}</div>
        <div class="stat-label">Pemasukan Hari Ini</div>
      </div>
    `;

    const tbody = document.querySelector('#recent-table tbody');
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

    const receipts = await fetch(`${API}/receipts?${params}`).then(r => r.json());
    const tbody = document.querySelector('#receipts-table tbody');

    if (receipts.length === 0) {
      tbody.innerHTML = `<tr><td colspan="9" class="empty-state"><div class="empty-icon">📋</div><p>Tidak ada data ditemukan</p></td></tr>`;
      return;
    }

    tbody.innerHTML = receipts.map(r => `
      <tr>
        <td><strong>${r.receipt_number}</strong></td>
        <td>${r.customer_name}</td>
        <td>${r.customer_phone || '-'}</td>
        <td>${r.device_type} ${r.device_brand} ${r.device_model}</td>
        <td title="${escapeHtml(r.complaint)}">${truncate(r.complaint, 40)}</td>
        <td title="${escapeHtml(r.notes || '')}">${truncate(r.notes || '-', 40)}</td>
        <td>${formatRupiah(r.estimated_cost)}</td>
        <td>${formatRupiah(r.down_payment)}</td>
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
    document.getElementById('f-estimated_cost').value = numId(data.estimated_cost);
    document.getElementById('f-down_payment').value = numId(data.down_payment);
    document.getElementById('f-status').value = data.status || 'diterima';
  } else {
    document.getElementById('modal-title').textContent = 'Tanda Terima Baru';
    document.getElementById('f-receipt_number').value = '(auto)';
    document.getElementById('f-date').value = new Date().toLocaleDateString('id-ID');
  }
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
    estimated_cost: parseRupiah(document.getElementById('f-estimated_cost').value),
    down_payment: parseRupiah(document.getElementById('f-down_payment').value),
    status: document.getElementById('f-status').value
  };

  try {
    const url = id ? `${API}/receipts/${id}` : `${API}/receipts`;
    const method = id ? 'PUT' : 'POST';
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!res.ok) throw new Error();

    showToast(id ? 'Tanda terima berhasil diupdate' : 'Tanda terima berhasil dibuat');
    closeModal();
    if (currentPage === 'receipts') loadReceipts();
    else if (currentPage === 'dashboard') loadDashboard();
  } catch (err) {
    showToast('Gagal menyimpan data', 'error');
  }
});

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
  const remaining = (r.estimated_cost || 0) - (r.down_payment || 0);
  const size = document.getElementById('print-size').value;

  const content = document.getElementById('print-content');
  content.className = `print-sheet print-${size}`;

  document.body.classList.remove('printing-dotmatrix', 'printing-halfa4', 'printing-a4');
  document.body.classList.add(`printing-${size}`);

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
      + `Status: ${statusLabel(r.status)}\n\n`
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

    <hr class="receipt-divider">
    <div class="receipt-row">
      <span>Estimasi Biaya</span>
      <span>${formatRupiah(r.estimated_cost)}</span>
    </div>
    <div class="receipt-row">
      <span>Uang Muka (DP)</span>
      <span>${formatRupiah(r.down_payment)}</span>
    </div>
    <div class="receipt-row receipt-bold">
      <span>Sisa Bayar</span>
      <span>${formatRupiah(remaining)}</span>
    </div>

    <hr class="receipt-divider">
    <div class="receipt-row">
      <span>Status</span>
      <span class="receipt-bold">${statusLabel(r.status)}</span>
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
    </table>

    <div class="a4-cost">
      <div class="a4-cost-row"><span>Estimasi Biaya</span><span>${formatRupiah(r.estimated_cost)}</span></div>
      <div class="a4-cost-row"><span>Uang Muka (DP)</span><span>${formatRupiah(r.down_payment)}</span></div>
      <div class="a4-cost-row a4-total"><span>Sisa Bayar</span><span>${formatRupiah(remaining)}</span></div>
    </div>

    <div class="a4-status">
      <p>Status: <b>${statusLabel(r.status)}</b></p>
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
    </table>

    <div class="a4-cost">
      <div class="a4-cost-row"><span>Estimasi Biaya</span><span>${formatRupiah(r.estimated_cost)}</span></div>
      <div class="a4-cost-row"><span>Uang Muka (DP)</span><span>${formatRupiah(r.down_payment)}</span></div>
      <div class="a4-cost-row a4-total"><span>Sisa Bayar</span><span>${formatRupiah(remaining)}</span></div>
    </div>

    <div class="a4-status">
      <p>Status: <b>${statusLabel(r.status)}</b></p>
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
      thead.innerHTML = '<tr><th>Tanggal</th><th>Jumlah</th><th>Total Estimasi</th><th>Total DP</th></tr>';
      if (data.detail.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="empty-state"><p>Tidak ada data</p></td></tr>';
        return;
      }
      tbody.innerHTML = data.detail.map(d => `
        <tr>
          <td>${d.tanggal}</td>
          <td>${d.count}</td>
          <td>${formatRupiah(d.total_estimate)}</td>
          <td>${formatRupiah(d.total_dp)}</td>
        </tr>
      `).join('');
    } else {
      thead.innerHTML = '<tr><th>No. Receipt</th><th>Pelanggan</th><th>Tanggal</th><th>Estimasi</th><th>DP</th><th>Status</th></tr>';
      if (data.detail.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty-state"><p>Tidak ada data</p></td></tr>';
        return;
      }
      tbody.innerHTML = data.detail.map(r => `
        <tr>
          <td><strong>${r.receipt_number}</strong></td>
          <td>${r.customer_name}</td>
          <td>${formatDate(r.created_at)}</td>
          <td>${formatRupiah(r.estimated_cost)}</td>
          <td>${formatRupiah(r.down_payment)}</td>
          <td>${statusBadge(r.status)}</td>
        </tr>
      `).join('');
    }
  } catch (err) {
    showToast('Gagal memuat laporan', 'error');
  }
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
