const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const M = require('./master-db');
const T = require('./tenant-db');
const { MASTER_UPLOADS } = M;

const tenantTokens = new Map();   // token -> tenantId
const adminTokens = new Map();    // token -> timestamp
const DAYS_PER_PAYMENT = 30;      // 1 bulan per pembayaran

// ---------- helpers ----------
function bearer(req) {
  const auth = req.headers.authorization || '';
  return auth.replace(/^Bearer\s+/i, '');
}

function createToken() {
  return crypto.randomBytes(24).toString('hex');
}

function cleanPayments(p) {
  return {
    id: p.id, tenant_id: p.tenant_id, amount: p.amount,
    note: p.note, status: p.status, created_at: p.created_at,
    confirmed_at: p.confirmed_at
  };
}

function safeTenant(t) {
  if (!t) return null;
  return {
    id: t.id, username: t.username, shop_name: t.shop_name,
    phone: t.phone, created_at: t.created_at, trial_end: t.trial_end,
    sub_end: t.sub_end, status: t.status, note: t.note,
    effective_status: M.effectiveStatus(t)
  };
}

function pricingConfig() {
  return {
    price: M.getSetting('price') || '50000',
    trial_days: M.getSetting('trial_days') || '3',
    bank_name: M.getSetting('bank_name') || '',
    bank_account: M.getSetting('bank_account') || '',
    bank_holder: M.getSetting('bank_holder') || '',
    qris_image: M.getSetting('qris_image') || ''
  };
}

function subscriptionPayload(t) {
  const { price, trial_days, bank_name, bank_account, bank_holder, qris_image } = pricingConfig();
  return {
    effective_status: M.effectiveStatus(t),
    trial_end: t.trial_end,
    sub_end: t.sub_end,
    status: t.status,
    price, trial_days,
    bank_name, bank_account, bank_holder, qris_image
  };
}

async function ensureTenantDb(tenant) {
  if (!T.get(tenant.id)) await T.init(tenant);
  return tenant;
}

// ---------- middleware ----------
async function requireTenant(req, res, next) {
  const token = bearer(req);
  if (!token || !tenantTokens.has(token)) {
    return res.status(401).json({ error: 'Tidak terautentikasi' });
  }
  const tenant = M.queryOne('SELECT * FROM tenants WHERE id = ?', [tenantTokens.get(token)]);
  if (!tenant) return res.status(401).json({ error: 'Tidak terautentikasi' });

  const eff = M.effectiveStatus(tenant);
  if (eff === 'suspended') {
    return res.status(403).json({ error: 'Akun ini dinonaktifkan. Hubungi admin.', code: 'SUSPENDED' });
  }
  if (eff === 'expired') {
    return res.status(403).json({ error: 'Masa langganan habis. Silakan perpanjang.', code: 'SUBSCRIPTION_EXPIRED' });
  }

  req.tenantId = tenant.id;
  req.tenant = await ensureTenantDb(tenant);
  next();
}

async function requireTenantSoft(req, res, next) {
  const token = bearer(req);
  if (!token || !tenantTokens.has(token)) {
    return res.status(401).json({ error: 'Tidak terautentikasi' });
  }
  const tenant = M.queryOne('SELECT * FROM tenants WHERE id = ?', [tenantTokens.get(token)]);
  if (!tenant) return res.status(401).json({ error: 'Tidak terautentikasi' });
  req.tenantId = tenant.id;
  req.tenant = await ensureTenantDb(tenant);
  next();
}

function requireAdmin(req, res, next) {
  const token = bearer(req);
  if (!token || !adminTokens.has(token)) {
    return res.status(401).json({ error: 'Tidak terautentikasi' });
  }
  req.adminToken = token;
  next();
}

// ---------- query helpers (per tenant) ----------
function all(req, sql, params = []) { return T.query(req.tenantId, sql, params); }
function one(req, sql, params = []) { return T.queryOne(req.tenantId, sql, params); }
function runq(req, sql, params = []) { return T.run(req.tenantId, sql, params); }

function getTenantSetting(req, key) {
  const r = one(req, 'SELECT value FROM settings WHERE key = ?', [key]);
  return r ? r.value : '';
}

function generateReceiptNumber(req) {
  const date = new Date();
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const prefix = `SRV-${y}${m}${d}`;
  const last = one(req,
    "SELECT receipt_number FROM receipts WHERE receipt_number LIKE ? ORDER BY id DESC LIMIT 1",
    [`${prefix}%`]
  );
  let seq = 1;
  if (last) {
    const parts = last.receipt_number.split('-');
    seq = parseInt(parts[2]) + 1;
  }
  return `${prefix}-${String(seq).padStart(4, '0')}`;
}

function tenantLogoPath(req) {
  const current = getTenantSetting(req, 'shop_logo');
  if (!current) return null;
  const full = path.join(T.uploadsDir(req.tenantId), path.basename(current));
  return fs.existsSync(full) ? full : null;
}

function tenantSettingsObject(req) {
  const rows = all(req, 'SELECT * FROM settings');
  const obj = {};
  rows.forEach(r => { obj[r.key] = r.value; });
  return obj;
}

// ============================================================
//  AUTH TOKO
// ============================================================
router.post('/auth/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username dan password wajib diisi' });
  }
  const tenant = M.queryOne('SELECT * FROM tenants WHERE username = ?', [String(username).trim()]);
  if (!tenant || password !== tenant.password) {
    return res.status(401).json({ error: 'Username atau password salah' });
  }
  const token = createToken();
  tenantTokens.set(token, tenant.id);
  const t = await ensureTenantDb(tenant);
  res.json({ token, username: t.username, shopName: t.shop_name, subscription: subscriptionPayload(t) });
});

router.get('/auth/check', requireTenantSoft, (req, res) => {
  res.json({ ok: true, username: req.tenant.username, shopName: req.tenant.shop_name, subscription: subscriptionPayload(req.tenant) });
});

router.post('/auth/logout', requireTenantSoft, (req, res) => {
  const token = bearer(req);
  tenantTokens.delete(token);
  res.json({ ok: true });
});

router.put('/auth/password', requireTenantSoft, (req, res) => {
  const { current, password } = req.body || {};
  if (!current || !password) return res.status(400).json({ error: 'Password lama dan baru wajib diisi' });
  if (current !== req.tenant.password) return res.status(401).json({ error: 'Password lama salah' });
  if (String(password).length < 6) return res.status(400).json({ error: 'Password baru minimal 6 karakter' });
  M.run('UPDATE tenants SET password = ? WHERE id = ?', [String(password), req.tenant.id]);
  res.json({ success: true });
});

// ============================================================
//  SUBSCRIPTION TOKO (Cek status, kirim bukti bayar)
// ============================================================
router.get('/subscription', requireTenantSoft, (req, res) => {
  res.json(subscriptionPayload(req.tenant));
});

router.post('/subscription/pay', requireTenantSoft, (req, res) => {
  const { note, proof } = req.body || {};
  if (!proof) return res.status(400).json({ error: 'Bukti transfer wajib diunggah' });
  const m = proof.match(/^data:image\/(png|jpe?g|gif|webp);base64,(.+)$/i);
  if (!m) return res.status(400).json({ error: 'Bukti harus berupa gambar (PNG/JPG)' });
  const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
  const buffer = Buffer.from(m[2], 'base64');
  const MAX = 2 * 1024 * 1024;
  if (buffer.length > MAX) return res.status(400).json({ error: 'Bukti maksimal 2MB' });

  const dir = T.uploadsDir(req.tenant.id);
  fs.mkdirSync(dir, { recursive: true });
  const fname = `proof-${Date.now()}.${ext}`;
  fs.writeFileSync(path.join(dir, fname), buffer);

  M.run(
    'INSERT INTO payments (id, tenant_id, amount, note, proof, status) VALUES (?, ?, ?, ?, ?, ?)',
    [M.genId('PMT'), req.tenant.id, parseInt(M.getSetting('price') || '50000'), note || '', `/uploads/${req.tenant.id}/${fname}`, 'pending']
  );
  res.status(201).json({ success: true, message: 'Bukti terkirim. Menunggu konfirmasi admin.' });
});

// ============================================================
//  ENDPOINT PUBLIK (tanpa login)
// ============================================================
router.get('/public/pricing', (req, res) => {
  res.json(pricingConfig());
});

router.post('/public/register', async (req, res) => {
  const { shop_name, username, password, phone } = req.body || {};

  const name = String(shop_name || '').trim();
  const user = String(username || '').trim().toLowerCase();
  if (name.length < 2) return res.status(400).json({ error: 'Nama toko minimal 2 karakter' });
  if (!/^[a-z0-9._-]{3,20}$/.test(user)) {
    return res.status(400).json({ error: 'Username 3-20 karakter (huruf kecil, angka, titik, garis bawah/minus)' });
  }
  if (!password || String(password).length < 6) {
    return res.status(400).json({ error: 'Password minimal 6 karakter' });
  }
  const dup = M.queryOne('SELECT id FROM tenants WHERE username = ?', [user]);
  if (dup) return res.status(400).json({ error: 'Username sudah dipakai, pilih yang lain' });

  const trialDays = parseInt(M.getSetting('trial_days') || '3');
  const id = M.genId('TEN');
  M.run(
    `INSERT INTO tenants (id, username, password, shop_name, phone, trial_end, status)
     VALUES (?, ?, ?, ?, ?, ?, 'trial')`,
    [id, user, String(password), name, String(phone || ''), M.addDaysIso(trialDays)]
  );
  const tenant = M.queryOne('SELECT * FROM tenants WHERE id = ?', [id]);
  await ensureTenantDb(tenant);
  res.status(201).json({ success: true, message: `Akun dibuat. Coba gratis ${trialDays} hari.`, trial_days: trialDays });
});

// Info toko untuk halaman publik (per toko)
router.get('/public/shopinfo', async (req, res) => {
  const u = String(req.query.u || '').trim().toLowerCase();
  if (!u) return res.status(400).json({ error: 'Parameter toko wajib (u)' });
  const tenant = M.queryOne('SELECT * FROM tenants WHERE username = ?', [u]);
  if (!tenant) return res.status(404).json({ error: 'Toko tidak ditemukan' });
  await T.init(tenant).catch(() => {});
  const rows = T.query(tenant.id, 'SELECT * FROM settings');
  const obj = { username: tenant.username, shop_name: tenant.shop_name, effective_status: M.effectiveStatus(tenant) };
  rows.forEach(r => { obj[r.key] = r.value; });
  res.json(obj);
});

// Cek status tanda terima oleh pelanggan (per toko)
router.get('/public/track', async (req, res) => {
  const { no, hp, u } = req.query;
  if (!u) return res.status(400).json({ error: 'Parameter toko wajib (u)' });
  if (!no || !hp) return res.status(400).json({ error: 'No. Receipt dan No. HP wajib diisi' });

  const tenant = M.queryOne('SELECT * FROM tenants WHERE username = ?', [String(u).trim().toLowerCase()]);
  if (!tenant) return res.status(404).json({ error: 'Toko tidak ditemukan' });
  await T.init(tenant).catch(() => {});
  const eff = M.effectiveStatus(tenant);
  if (eff === 'expired' || eff === 'suspended') {
    return res.status(404).json({ error: 'Toko tidak ditemukan' });
  }

  const row = T.queryOne(tenant.id,
    `SELECT receipt_number, customer_name, customer_phone, device_type,
       device_brand, device_model, complaint, status, created_at, updated_at
     FROM receipts WHERE receipt_number = ? AND customer_phone = ?`,
    [no.trim(), hp.trim()]
  );
  if (!row) {
    return res.status(404).json({ error: 'Tidak ditemukan. Periksa kembali No. Receipt dan No. HP.' });
  }
  res.json(row);
});

// ============================================================
//  DATA APP TOKO (dilindungi requireTenant)
// ============================================================
router.use('/receipts', requireTenant);
router.use('/stats', requireTenant);
router.use('/settings', requireTenant);
router.use('/report', requireTenant);

// List all receipts
router.get('/receipts', (req, res) => {
  const { search, status } = req.query;
  let sql = 'SELECT * FROM receipts WHERE 1=1';
  const params = [];
  if (search) {
    sql += ' AND (receipt_number LIKE ? OR customer_name LIKE ? OR customer_phone LIKE ?)';
    const s = `%${search}%`;
    params.push(s, s, s);
  }
  if (status && status !== 'semua') {
    sql += ' AND status = ?';
    params.push(status);
  }
  sql += ' ORDER BY id DESC';
  res.json(all(req, sql, params));
});

// Get single receipt
router.get('/receipts/:id', (req, res) => {
  const row = one(req, 'SELECT * FROM receipts WHERE id = ?', [parseInt(req.params.id)]);
  if (!row) return res.status(404).json({ error: 'Tidak ditemukan' });
  res.json(row);
});

// Create receipt
router.post('/receipts', (req, res) => {
  const receipt_number = generateReceiptNumber(req);
  const {
    customer_name, customer_phone, customer_address,
    device_type, device_brand, device_model, device_serial,
    complaint, notes, estimated_cost, down_payment, status
  } = req.body;

  runq(req, `
    INSERT INTO receipts (receipt_number, customer_name, customer_phone, customer_address,
      device_type, device_brand, device_model, device_serial, complaint, notes,
      estimated_cost, down_payment, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    receipt_number, customer_name, customer_phone || '', customer_address || '',
    device_type || '', device_brand || '', device_model || '', device_serial || '',
    complaint || '', notes || '',
    estimated_cost || 0, down_payment || 0, status || 'diterima'
  ]);

  const row = one(req, 'SELECT * FROM receipts WHERE receipt_number = ?', [receipt_number]);
  res.status(201).json(row);
});

// Update receipt
router.put('/receipts/:id', (req, res) => {
  const {
    customer_name, customer_phone, customer_address,
    device_type, device_brand, device_model, device_serial,
    complaint, notes, estimated_cost, down_payment, status
  } = req.body;

  runq(req, `
    UPDATE receipts SET
      customer_name = ?, customer_phone = ?, customer_address = ?,
      device_type = ?, device_brand = ?, device_model = ?, device_serial = ?,
      complaint = ?, notes = ?, estimated_cost = ?, down_payment = ?,
      status = ?, updated_at = datetime('now','localtime')
    WHERE id = ?
  `, [
    customer_name, customer_phone || '', customer_address || '',
    device_type || '', device_brand || '', device_model || '', device_serial || '',
    complaint || '', notes || '',
    estimated_cost || 0, down_payment || 0, status || 'diterima',
    parseInt(req.params.id)
  ]);

  const row = one(req, 'SELECT * FROM receipts WHERE id = ?', [parseInt(req.params.id)]);
  if (!row) return res.status(404).json({ error: 'Tidak ditemukan' });
  res.json(row);
});

// Delete receipt
router.delete('/receipts/:id', (req, res) => {
  const before = one(req, 'SELECT id FROM receipts WHERE id = ?', [parseInt(req.params.id)]);
  runq(req, 'DELETE FROM receipts WHERE id = ?', [parseInt(req.params.id)]);
  if (!before) return res.status(404).json({ error: 'Tidak ditemukan' });
  res.json({ success: true });
});

// Settings toko
router.get('/settings', (req, res) => {
  res.json(tenantSettingsObject(req));
});

router.put('/settings', (req, res) => {
  for (const [key, value] of Object.entries(req.body)) {
    if (key === 'shop_logo') continue;
    runq(req, 'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, value]);
  }
  res.json({ success: true });
});

// Upload logo toko
router.post('/settings/logo', (req, res) => {
  const data = req.body.data || '';
  const m = data.match(/^data:(image\/(png|jpe?g|gif|webp));base64,(.+)$/i);
  if (!m) return res.status(400).json({ error: 'File harus gambar (PNG/JPG)' });
  const ext = m[2] === 'jpeg' ? 'jpg' : m[2];
  const buffer = Buffer.from(m[3], 'base64');
  const MAX = 2 * 1024 * 1024;
  if (buffer.length > MAX) return res.status(400).json({ error: 'Ukuran logo maksimal 2MB' });

  const dir = T.uploadsDir(req.tenant.id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'logo.' + ext), buffer);

  const url = `/uploads/${req.tenant.id}/uploads/logo.${ext}`;
  runq(req, 'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ['shop_logo', url]);
  res.json({ success: true });
});

// Hapus logo
router.delete('/settings/logo', (req, res) => {
  const current = getTenantSetting(req, 'shop_logo');
  if (current) {
    try { fs.unlinkSync(path.join(T.uploadsDir(req.tenant.id), path.basename(current))); } catch (e) {}
    runq(req, "DELETE FROM settings WHERE key = 'shop_logo'");
  }
  res.json({ success: true });
});

// Stats
router.get('/stats', (req, res) => {
  const total = one(req, 'SELECT COUNT(*) as count FROM receipts').count;
  const diterima = one(req, "SELECT COUNT(*) as count FROM receipts WHERE status='diterima'").count;
  const diproses = one(req, "SELECT COUNT(*) as count FROM receipts WHERE status='diproses'").count;
  const selesai = one(req, "SELECT COUNT(*) as count FROM receipts WHERE status='selesai'").count;
  const diambil = one(req, "SELECT COUNT(*) as count FROM receipts WHERE status='diambil'").count;
  const todayRevenue = one(req,
    "SELECT COALESCE(SUM(down_payment),0) as total FROM receipts WHERE date(created_at) = date('now','localtime')"
  ).total;
  res.json({ total, diterima, diproses, selesai, diambil, todayRevenue });
});

// Report: revenue per period
router.get('/report', (req, res) => {
  const { from, to, status, groupBy } = req.query;
  let where = 'WHERE 1=1';
  const params = [];

  if (from) { where += ' AND date(created_at) >= ?'; params.push(from); }
  if (to) { where += ' AND date(created_at) <= ?'; params.push(to); }
  if (status && status !== 'semua') { where += ' AND status = ?'; params.push(status); }

  const summary = one(req, `
    SELECT
      COUNT(*) as count,
      COALESCE(SUM(down_payment),0) as total_dp,
      COALESCE(SUM(estimated_cost),0) as total_estimate,
      COALESCE(SUM(estimated_cost),0) - COALESCE(SUM(down_payment),0) as total_remaining
    FROM receipts ${where}
  `, params);

  let detail;
  if (groupBy === 'date') {
    detail = all(req, `
      SELECT date(created_at) as tanggal,
        COUNT(*) as count,
        COALESCE(SUM(down_payment),0) as total_dp,
        COALESCE(SUM(estimated_cost),0) as total_estimate
      FROM receipts ${where}
      GROUP BY date(created_at)
      ORDER BY tanggal DESC
    `, params);
  } else {
    detail = all(req, `SELECT * FROM receipts ${where} ORDER BY id DESC`, params);
  }

  res.json({ summary, detail });
});

// Export PDF (A4)
router.get('/receipts/:id/export', (req, res) => {
  const r = one(req, 'SELECT * FROM receipts WHERE id = ?', [parseInt(req.params.id)]);
  if (!r) return res.status(404).json({ error: 'Tidak ditemukan' });
  const settings = tenantSettingsObject(req);
  const { buildA4 } = require('./pdf');
  const doc = buildA4(settings, r, tenantLogoPath(req));
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${r.receipt_number}.pdf"`);
  doc.pipe(res);
  doc.end();
});

// Export PDF (Setengah A4)
router.get('/receipts/:id/export/half', (req, res) => {
  const r = one(req, 'SELECT * FROM receipts WHERE id = ?', [parseInt(req.params.id)]);
  if (!r) return res.status(404).json({ error: 'Tidak ditemukan' });
  const settings = tenantSettingsObject(req);
  const { buildHalfA4 } = require('./pdf');
  const doc = buildHalfA4(settings, r, tenantLogoPath(req));
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${r.receipt_number}-half.pdf"`);
  doc.pipe(res);
  doc.end();
});

// ============================================================
//  SUPER ADMIN (Penjual)
// ============================================================
router.post('/admin/login', (req, res) => {
  const { username, password } = req.body || {};
  const adminUsername = M.getSetting('admin_username') || 'admin';
  const adminPassword = M.getSetting('admin_password') || 'admin123';
  if (!username || !password || String(username).trim() !== adminUsername || password !== adminPassword) {
    return res.status(401).json({ error: 'Username atau password admin salah' });
  }
  const token = createToken();
  adminTokens.set(token, Date.now());
  res.json({ token, username: adminUsername });
});

router.get('/admin/check', requireAdmin, (req, res) => {
  res.json({ ok: true });
});

router.get('/admin/settings', requireAdmin, (req, res) => {
  res.json(pricingConfig());
});

router.put('/admin/settings', requireAdmin, (req, res) => {
  const { price, trial_days, bank_name, bank_account, bank_holder } = req.body || {};
  if (price !== undefined) M.setSetting('price', String(price).replace(/[^\d]/g, '')) || 0;
  if (trial_days !== undefined) M.setSetting('trial_days', String(trial_days));
  if (bank_name !== undefined) M.setSetting('bank_name', String(bank_name));
  if (bank_account !== undefined) M.setSetting('bank_account', String(bank_account));
  if (bank_holder !== undefined) M.setSetting('bank_holder', String(bank_holder));
  res.json(pricingConfig());
});

router.post('/admin/settings/qris', requireAdmin, (req, res) => {
  const data = (req.body && req.body.data) || '';
  const m = data.match(/^data:image\/(png|jpe?g|gif|webp);base64,(.+)$/i);
  if (!m) return res.status(400).json({ error: 'QRIS harus berupa gambar (PNG/JPG)' });
  const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
  const buffer = Buffer.from(m[2], 'base64');
  const MAX = 5 * 1024 * 1024;
  if (buffer.length > MAX) return res.status(400).json({ error: 'Ukuran QRIS maksimal 5MB' });

  fs.mkdirSync(MASTER_UPLOADS, { recursive: true });
  fs.writeFileSync(path.join(MASTER_UPLOADS, 'qris.png'), buffer);

  const url = `/qris/qris.png`;
  M.setSetting('qris_image', url);
  res.json(pricingConfig());
});

router.delete('/admin/settings/qris', requireAdmin, (req, res) => {
  const current = M.getSetting('qris_image');
  if (current) {
    try { fs.unlinkSync(path.join(MASTER_UPLOADS, path.basename(current))); } catch (e) {}
    M.run("DELETE FROM settings WHERE key = 'qris_image'");
  }
  res.json(pricingConfig());
});

router.get('/admin/tenants', requireAdmin, (req, res) => {
  const rows = M.query('SELECT * FROM tenants ORDER BY created_at DESC');
  res.json(rows.map(safeTenant));
});

router.post('/admin/tenants', requireAdmin, async (req, res) => {
  const { shop_name, username, password, phone } = req.body || {};
  const name = String(shop_name || '').trim();
  const user = String(username || '').trim().toLowerCase();
  if (name.length < 2) return res.status(400).json({ error: 'Nama toko minimal 2 karakter' });
  if (!/^[a-z0-9._-]{3,20}$/.test(user)) return res.status(400).json({ error: 'Username tidak valid' });
  if (!password || String(password).length < 6) return res.status(400).json({ error: 'Password minimal 6 karakter' });
  if (M.queryOne('SELECT id FROM tenants WHERE username = ?', [user])) {
    return res.status(400).json({ error: 'Username sudah dipakai' });
  }
  const id = M.genId('TEN');
  M.run(
    `INSERT INTO tenants (id, username, password, shop_name, phone, sub_end, status)
     VALUES (?, ?, ?, ?, ?, ?, 'active')`,
    [id, user, String(password), name, String(phone || ''), M.addDaysIso(DAYS_PER_PAYMENT)]
  );
  const tenant = M.queryOne('SELECT * FROM tenants WHERE id = ?', [id]);
  await ensureTenantDb(tenant);
  res.status(201).json(safeTenant(tenant));
});

router.post('/admin/tenants/:id/extend', requireAdmin, (req, res) => {
  const tenant = M.queryOne('SELECT * FROM tenants WHERE id = ?', [req.params.id]);
  if (!tenant) return res.status(404).json({ error: 'Toko tidak ditemukan' });
  const days = parseInt(req.body.days) || DAYS_PER_PAYMENT;
  const updated = M.extendByDays(tenant, days);
  res.json(safeTenant(updated));
});

router.post('/admin/tenants/:id/suspend', requireAdmin, (req, res) => {
  M.run("UPDATE tenants SET status = 'suspended' WHERE id = ?", [req.params.id]);
  res.json({ success: true });
});

router.post('/admin/tenants/:id/unsuspend', requireAdmin, (req, res) => {
  const tenant = M.queryOne('SELECT * FROM tenants WHERE id = ?', [req.params.id]);
  if (!tenant) return res.status(404).json({ error: 'Toko tidak ditemukan' });
  M.run("UPDATE tenants SET status = 'active' WHERE id = ?", [req.params.id]);
  res.json({ success: true });
});

router.delete('/admin/tenants/:id', requireAdmin, (req, res) => {
  const tenant = M.queryOne('SELECT * FROM tenants WHERE id = ?', [req.params.id]);
  if (!tenant) return res.status(404).json({ error: 'Toko tidak ditemukan' });
  M.run("DELETE FROM tenants WHERE id = ?", [req.params.id]);
  M.run("DELETE FROM payments WHERE tenant_id = ?", [req.params.id]);
  T.remove(req.params.id);
  res.json({ success: true });
});

router.get('/admin/payments', requireAdmin, (req, res) => {
  const { status } = req.query;
  let sql = 'SELECT * FROM payments';
  const params = [];
  if (status) { sql += ' WHERE status = ?'; params.push(status); }
  sql += ' ORDER BY created_at DESC';
  const rows = M.query(sql, params);
  res.json(rows.map(p => {
    const t = M.queryOne('SELECT shop_name, username FROM tenants WHERE id = ?', [p.tenant_id]);
    return { ...cleanPayments(p), shop: t ? t.shop_name : '-', username: t ? t.username : '-' };
  }));
});

router.post('/admin/payments/:id/confirm', (req, res) => {
  const pay = M.queryOne('SELECT * FROM payments WHERE id = ?', [req.params.id]);
  if (!pay) return res.status(404).json({ error: 'Pembayaran tidak ditemukan' });
  const tenant = M.queryOne('SELECT * FROM tenants WHERE id = ?', [pay.tenant_id]);
  if (!tenant) return res.status(404).json({ error: 'Toko tidak ditemukan' });
  M.run('UPDATE payments SET status = ? , confirmed_at = datetime(\'now\',\'localtime\') WHERE id = ?', ['confirmed', pay.id]);
  const updated = M.extendByDays(tenant, DAYS_PER_PAYMENT);
  res.json({ success: true, tenant: safeTenant(updated) });
});

router.post('/admin/payments/:id/reject', requireAdmin, (req, res) => {
  M.run('UPDATE payments SET status = ? WHERE id = ?', ['rejected', req.params.id]);
  res.json({ success: true });
});

module.exports = router;