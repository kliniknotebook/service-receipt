const API = '/api';
let adminSettings = {};

function fmtDate(s) {
  if (!s) return '-';
  const d = new Date(String(s).replace(' ', 'T'));
  return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatRupiah(n) {
  return 'Rp ' + Number(n || 0).toLocaleString('id-ID');
}

function badge(st) {
  const map = {
    trial: { cls: 'trial-badge', label: 'Trial' },
    active: { cls: 'active-badge', label: 'Aktif' },
    expired: { cls: 'expired-badge', label: 'Habis' },
    suspended: { cls: 'suspended-badge', label: 'Nonaktif' }
  };
  const b = map[st] || map.expired;
  return `<span class="badge-pill ${b.cls}">${b.label}</span>`;
}

function showToast(t, type = 'success') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = t;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

async function api(path, opts = {}) {
  opts.headers = Object.assign({}, opts.headers, { 'Authorization': 'Bearer ' + localStorage.getItem('admin_token') });
  if (opts.body && !opts.headers['Content-Type']) opts.headers['Content-Type'] = 'application/json';
  const res = await fetch(API + path, opts);
  if (res.status === 401 && path !== '/admin/login') {
    localStorage.removeItem('admin_token');
    location.reload();
  }
  return res;
}

function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + name));
  if (name === 'payments') loadPayments();
  if (name === 'tenants') loadTenants();
  if (name === 'settings') loadAdminSettings();
}

// ---------- login ----------
document.getElementById('admin-login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = document.getElementById('al-error');
  err.textContent = '';
  try {
    const res = await api('/admin/login', {
      method: 'POST',
      body: JSON.stringify({
        username: document.getElementById('al-user').value.trim(),
        password: document.getElementById('al-pass').value
      })
    });
    const data = await res.json();
    if (!res.ok) { err.textContent = data.error || 'Login gagal'; return; }
    localStorage.setItem('admin_token', data.token);
    document.getElementById('admin-login').style.display = 'none';
    document.getElementById('admin-app').style.display = 'block';
    document.getElementById('a-shop').style.display = '';
    document.getElementById('btn-admin-logout').style.display = '';
    boot();
  } catch (e2) { err.textContent = 'Terjadi kesalahan. Coba lagi.'; }
});

document.getElementById('btn-admin-logout').addEventListener('click', (e) => {
  e.preventDefault();
  localStorage.removeItem('admin_token');
  location.reload();
});

// ---------- dashboard ----------
async function loadOverview() {
  const [tenants, payments] = await Promise.all([
    api('/admin/tenants').then(r => r.json()),
    api('/admin/payments').then(r => r.json())
  ]);
  const eff = {};
  tenants.forEach(t => { eff[t.id] = t.effective_status; });
  const count = st => tenants.filter(t => (eff[t.id] || 'expired') === st).length;
  const pending = payments.filter(p => p.status === 'pending');
  const revenue = payments.filter(p => p.status === 'confirmed').reduce((a, p) => a + (p.amount || 0), 0);
  document.getElementById('admin-stats').innerHTML = `
    <div class="stat-card blue"><div class="stat-value">${tenants.length}</div><div class="stat-label">Total Toko</div></div>
    <div class="stat-card orange"><div class="stat-value">${count('trial')}</div><div class="stat-label">Dalam Trial</div></div>
    <div class="stat-card green"><div class="stat-value">${count('active')}</div><div class="stat-label">Langganan Aktif</div></div>
    <div class="stat-card red"><div class="stat-value">${count('expired')}</div><div class="stat-label">Kedaluwarsa</div></div>
    <div class="stat-card teal"><div class="stat-value">${pending.length}</div><div class="stat-label">Menunggu Konfirmasi</div></div>
    <div class="stat-card purple"><div class="stat-value small">${formatRupiah(revenue)}</div><div class="stat-label">Total Terkumpul</div></div>
  `;
}

// ---------- payments ----------
async function loadPayments() {
  const payments = await api('/admin/payments').then(r => r.json());
  const pending = payments.filter(p => p.status === 'pending');
  const history = payments.filter(p => p.status !== 'pending');

  const tb = document.querySelector('#pay-table tbody');
  if (pending.length === 0) {
    tb.innerHTML = '<tr><td colspan="6" class="empty-state"><p>Tidak ada pembayaran menunggu 🎉</p></td></tr>';
  } else {
    tb.innerHTML = pending.map(p => `
      <tr>
        <td>${fmtDate(p.created_at)}</td>
        <td><strong>${p.shop}</strong><br><span class="muted">${p.username}</span></td>
        <td>${p.note || '-'}</td>
        <td>${formatRupiah(p.amount)}</td>
        <td><a class="proof-link" href="${p.proof}" target="_blank" rel="noopener">Lihat Bukti ↗</a></td>
        <td>
          <div class="inline-flex">
            <button class="btn btn-sm btn-success" onclick="confirmPay('${p.id}')">✓ Terima</button>
            <button class="btn btn-sm btn-danger" onclick="rejectPay('${p.id}')">✗ Tolak</button>
          </div>
        </td>
      </tr>
    `).join('');
  }

  const th = document.querySelector('#pay-history tbody');
  if (history.length === 0) {
    th.innerHTML = '<tr><td colspan="4" class="empty-state"><p>Belum ada riwayat</p></td></tr>';
  } else {
    th.innerHTML = history.map(p => `
      <tr>
        <td>${fmtDate(p.confirmed_at || p.created_at)}</td>
        <td>${p.shop}</td>
        <td>${formatRupiah(p.amount)}</td>
        <td>${p.status === 'confirmed' ? badge('active') + ' Terkonfirmasi' : 'Ditolak'}</td>
      </tr>
    `).join('');
  }
}

async function confirmPay(id) {
  if (!confirm('Konfirmasi pembayaran ini? Toko otomatis aktif +30 hari.')) return;
  await api('/admin/payments/' + id + '/confirm', { method: 'POST' });
  showToast('Pembayaran terkonfirmasi. Toko aktif.');
  loadPayments();
  loadOverview();
}

async function rejectPay(id) {
  if (!confirm('Tolak pembayaran ini?')) return;
  await api('/admin/payments/' + id + '/reject', { method: 'POST' });
  showToast('Pembayaran ditolak', 'error');
  loadPayments();
  loadOverview();
}

// ---------- tenants ----------
async function loadTenants() {
  const tenants = await api('/admin/tenants').then(r => r.json());
  const tb = document.querySelector('#ten-table tbody');
  if (tenants.length === 0) {
    tb.innerHTML = '<tr><td colspan="7" class="empty-state"><p>Belum ada toko</p></td></tr>';
    return;
  }
  tb.innerHTML = tenants.map(t => `
    <tr>
      <td><strong>${t.shop_name}</strong></td>
      <td>${t.username}</td>
      <td>${t.phone || '-'}</td>
      <td>${badge(t.effective_status)}</td>
      <td>${fmtDate(t.trial_end)}</td>
      <td>${fmtDate(t.sub_end)}</td>
      <td>
        <div class="inline-flex">
          <button class="btn btn-sm btn-success" onclick="extendTenant('${t.id}')">+30 hari</button>
          ${t.effective_status === 'suspended' || t.status === 'suspended'
            ? `<button class="btn btn-sm btn-primary" onclick="unsuspendTenant('${t.id}')">Aktifkan</button>`
            : `<button class="btn btn-sm btn-danger" onclick="suspendTenant('${t.id}')">Nonaktifkan</button>`}
          <button class="btn btn-sm btn-danger" onclick="deleteTenant('${t.id}','${t.shop_name.replace(/'/g, "\\'")}')">Hapus</button>
        </div>
      </td>
    </tr>
  `).join('');
}

async function extendTenant(id) {
  const days = prompt('Perpanjang berapa hari? (default 30)', '30');
  if (days === null) return;
  const n = parseInt(days);
  if (!n || n <= 0) return;
  await api('/admin/tenants/' + id + '/extend', { method: 'POST', body: JSON.stringify({ days: n }) });
  showToast('Masa aktif diperpanjang');
  loadTenants();
  loadOverview();
}

async function suspendTenant(id) {
  if (!confirm('Nonaktifkan toko ini?')) return;
  await api('/admin/tenants/' + id + '/suspend', { method: 'POST' });
  showToast('Toko dinonaktifkan', 'error');
  loadTenants();
  loadOverview();
}

async function unsuspendTenant(id) {
  await api('/admin/tenants/' + id + '/unsuspend', { method: 'POST' });
  showToast('Toko diaktifkan kembali');
  loadTenants();
  loadOverview();
}

async function deleteTenant(id, name) {
  if (!confirm('HAPUS PERMANEN toko "' + name + '"?\n\nSemua data toko (riwayat service, pengaturan) serta data pembayarannya akan dihapus dan TIDAK BISA dikembalikan. Lanjutkan?')) return;
  if (!confirm('Yakin, hapus toko "' + name + '" SELAMANYA?')) return;
  const res = await api('/admin/tenants/' + id, { method: 'DELETE' });
  if (!res.ok) {
    showToast('Gagal menghapus toko', 'error');
    return;
  }
  showToast('Toko "' + name + '" dihapus');
  loadTenants();
  loadOverview();
}

// ---------- settings ----------
async function loadAdminSettings() {
  const s = await api('/admin/settings').then(r => r.json());
  adminSettings = s;
  document.getElementById('set-price').value = s.price ? Number(s.price).toLocaleString('id-ID') : '50000';
  document.getElementById('set-trial_days').value = s.trial_days || '3';
  document.getElementById('set-bank_name').value = s.bank_name || '';
  document.getElementById('set-bank_account').value = s.bank_account || '';
  document.getElementById('set-bank_holder').value = s.bank_holder || '';
  const q = document.getElementById('qris-preview');
  if (s.qris_image) { q.src = s.qris_image; q.style.display = 'inline-block'; }
  else { q.src = ''; q.style.display = 'none'; }
}

document.getElementById('admin-settings-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const priceRaw = document.getElementById('set-price').value;
  const price = parseInt(String(priceRaw).replace(/[^\d]/g, ''), 10) || 50000;
  const body = {
    price: String(price),
    trial_days: document.getElementById('set-trial_days').value,
    bank_name: document.getElementById('set-bank_name').value,
    bank_account: document.getElementById('set-bank_account').value,
    bank_holder: document.getElementById('set-bank_holder').value
  };
  await api('/admin/settings', { method: 'PUT', body: JSON.stringify(body) });
  showToast('Pengaturan disimpan');
});

document.getElementById('qris-upload').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const res = await api('/admin/settings/qris', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: reader.result })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        showToast(err.error || 'Gagal upload QRIS', 'error');
        return;
      }
      const s = await res.json();
      const q = document.getElementById('qris-preview');
      q.src = s.qris_image; q.style.display = 'inline-block';
      showToast('QRIS berhasil diunggah');
    } catch (err) { showToast('Gagal upload QRIS', 'error'); }
  };
  reader.readAsDataURL(file);
});

document.getElementById('qris-remove').addEventListener('click', async () => {
  await api('/admin/settings/qris', { method: 'DELETE' });
  const q = document.getElementById('qris-preview');
  q.src = ''; q.style.display = 'none';
  document.getElementById('qris-upload').value = '';
  showToast('QRIS dihapus');
});

// ---------- create tenant ----------
document.getElementById('create-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = document.getElementById('c-msg');
  msg.textContent = '';
  try {
    const res = await api('/admin/tenants', {
      method: 'POST',
      body: JSON.stringify({
        shop_name: document.getElementById('c-name').value.trim(),
        username: document.getElementById('c-user').value.trim(),
        password: document.getElementById('c-pass').value,
        phone: document.getElementById('c-phone').value.trim()
      })
    });
    const data = await res.json();
    if (!res.ok) { msg.textContent = data.error || 'Gagal'; return; }
    document.getElementById('create-form').reset();
    msg.style.color = '#16a34a';
    msg.textContent = 'Toko berhasil dibuat (aktif 30 hari).';
    loadOverview();
  } catch (err) {
    msg.textContent = 'Terjadi kesalahan. Coba lagi.';
  }
});

// ---------- boot ----------
async function boot() {
  if (!localStorage.getItem('admin_token')) return;
  try {
    await loadOverview();
    loadPayments();
    loadTenants();
    loadAdminSettings();
  } catch (e) {}
}

if (localStorage.getItem('admin_token')) {
  document.getElementById('admin-login').style.display = 'none';
  document.getElementById('admin-app').style.display = 'block';
  document.getElementById('a-shop').style.display = '';
  document.getElementById('btn-admin-logout').style.display = '';
  boot();
} else {
  document.getElementById('admin-login').style.display = 'flex';
}