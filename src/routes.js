const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { getDB, saveDB } = require('./database');

const tokens = new Map();

function queryAll(sql, params = []) {
  const db = getDB();
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

function queryOne(sql, params = []) {
  const rows = queryAll(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

function runQuery(sql, params = []) {
  const db = getDB();
  db.run(sql, params);
  const lastId = db.exec('SELECT last_insert_rowid() as id')[0]?.values[0][0] || 0;
  const changes = db.getRowsModified();
  saveDB();
  return { lastInsertRowid: lastId, changes };
}

function generateReceiptNumber() {
  const date = new Date();
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const prefix = `SRV-${y}${m}${d}`;
  const last = queryOne(
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

// ---- Authentication ----
function getSetting(key) {
  const row = queryOne('SELECT value FROM settings WHERE key = ?', [key]);
  return row ? row.value : '';
}

function createToken() {
  return crypto.randomBytes(24).toString('hex');
}

function requireAuth(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token || !tokens.has(token)) {
    return res.status(401).json({ error: 'Tidak terautentikasi' });
  }
  req.adminToken = token;
  next();
}

// Login
router.post('/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  const adminUsername = process.env.ADMIN_USERNAME || getSetting('admin_username') || 'admin';
  const adminPassword = process.env.ADMIN_PASSWORD || getSetting('admin_password') || 'admin123';
  if (!username || !password || username.trim() !== adminUsername || password !== adminPassword) {
    return res.status(401).json({ error: 'Username atau password salah' });
  }
  const token = createToken();
  tokens.set(token, Date.now());
  res.json({ token, username: adminUsername });
});

// Check token validity
router.get('/auth/check', requireAuth, (req, res) => {
  const adminUsername = getSetting('admin_username') || 'admin';
  res.json({ ok: true, username: adminUsername });
});

// Logout
router.post('/auth/logout', requireAuth, (req, res) => {
  tokens.delete(req.adminToken);
  res.json({ ok: true });
});

// Protect all routes below except auth
router.use('/receipts', requireAuth);
router.use('/stats', requireAuth);
router.use('/settings', requireAuth);
router.use('/report', requireAuth);

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
  const rows = queryAll(sql, params);
  res.json(rows);
});

// Get single receipt
router.get('/receipts/:id', (req, res) => {
  const row = queryOne('SELECT * FROM receipts WHERE id = ?', [parseInt(req.params.id)]);
  if (!row) return res.status(404).json({ error: 'Tidak ditemukan' });
  res.json(row);
});

// Create receipt
router.post('/receipts', (req, res) => {
  const receipt_number = generateReceiptNumber();
  const {
    customer_name, customer_phone, customer_address,
    device_type, device_brand, device_model, device_serial,
    complaint, notes, estimated_cost, down_payment, status
  } = req.body;

  const info = runQuery(`
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

  const row = queryOne('SELECT * FROM receipts WHERE id = ?', [info.lastInsertRowid]);
  res.status(201).json(row);
});

// Update receipt
router.put('/receipts/:id', (req, res) => {
  const {
    customer_name, customer_phone, customer_address,
    device_type, device_brand, device_model, device_serial,
    complaint, notes, estimated_cost, down_payment, status
  } = req.body;

  runQuery(`
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

  const row = queryOne('SELECT * FROM receipts WHERE id = ?', [parseInt(req.params.id)]);
  if (!row) return res.status(404).json({ error: 'Tidak ditemukan' });
  res.json(row);
});

// Delete receipt
router.delete('/receipts/:id', (req, res) => {
  const before = queryOne('SELECT id FROM receipts WHERE id = ?', [parseInt(req.params.id)]);
  runQuery('DELETE FROM receipts WHERE id = ?', [parseInt(req.params.id)]);
  if (!before) return res.status(404).json({ error: 'Tidak ditemukan' });
  res.json({ success: true });
});

// Settings
router.get('/settings', (req, res) => {
  const rows = queryAll('SELECT * FROM settings');
  const obj = {};
  rows.forEach(r => {
    if (r.key !== 'admin_password') {
      obj[r.key] = r.value;
    }
  });
  res.json(obj);
});

router.put('/settings', (req, res) => {
  for (const [key, value] of Object.entries(req.body)) {
    if (key === 'admin_password' && !value) continue; // jangan timpa dengan kosong
    runQuery('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, value]);
  }
  res.json({ success: true });
});

// Stats
router.get('/stats', (req, res) => {
  const total = queryOne('SELECT COUNT(*) as count FROM receipts').count;
  const diterima = queryOne("SELECT COUNT(*) as count FROM receipts WHERE status='diterima'").count;
  const diproses = queryOne("SELECT COUNT(*) as count FROM receipts WHERE status='diproses'").count;
  const selesai = queryOne("SELECT COUNT(*) as count FROM receipts WHERE status='selesai'").count;
  const diambil = queryOne("SELECT COUNT(*) as count FROM receipts WHERE status='diambil'").count;
  const todayRevenue = queryOne(
    "SELECT COALESCE(SUM(down_payment),0) as total FROM receipts WHERE date(created_at) = date('now','localtime')"
  ).total;
  res.json({ total, diterima, diproses, selesai, diambil, todayRevenue });
});

// Report: revenue per period
router.get('/report', (req, res) => {
  const { from, to, status, groupBy } = req.query;
  let where = 'WHERE 1=1';
  const params = [];

  if (from) {
    where += ' AND date(created_at) >= ?';
    params.push(from);
  }
  if (to) {
    where += ' AND date(created_at) <= ?';
    params.push(to);
  }
  if (status && status !== 'semua') {
    where += ' AND status = ?';
    params.push(status);
  }

  // Summary
  const summary = queryOne(`
    SELECT
      COUNT(*) as count,
      COALESCE(SUM(down_payment),0) as total_dp,
      COALESCE(SUM(estimated_cost),0) as total_estimate,
      COALESCE(SUM(estimated_cost),0) - COALESCE(SUM(down_payment),0) as total_remaining
    FROM receipts ${where}
  `, params);

  // Detail rows (date group)
  let detail;
  if (groupBy === 'date') {
    detail = queryAll(`
      SELECT date(created_at) as tanggal,
        COUNT(*) as count,
        COALESCE(SUM(down_payment),0) as total_dp,
        COALESCE(SUM(estimated_cost),0) as total_estimate
      FROM receipts ${where}
      GROUP BY date(created_at)
      ORDER BY tanggal DESC
    `, params);
  } else {
    detail = queryAll(`
      SELECT *
      FROM receipts ${where}
      ORDER BY id DESC
    `, params);
  }

  res.json({ summary, detail });
});

// Export PDF (A4)
router.get('/receipts/:id/export', (req, res) => {
  const r = queryOne('SELECT * FROM receipts WHERE id = ?', [parseInt(req.params.id)]);
  if (!r) return res.status(404).json({ error: 'Tidak ditemukan' });

  const rows = queryAll('SELECT * FROM settings');
  const settings = {};
  rows.forEach(s => settings[s.key] = s.value);

  const { buildA4 } = require('./pdf');
  const doc = buildA4(settings, r);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${r.receipt_number}.pdf"`);
  doc.pipe(res);
  doc.end();
});

// Export PDF (Setengah A4)
router.get('/receipts/:id/export/half', (req, res) => {
  const r = queryOne('SELECT * FROM receipts WHERE id = ?', [parseInt(req.params.id)]);
  if (!r) return res.status(404).json({ error: 'Tidak ditemukan' });

  const rows = queryAll('SELECT * FROM settings');
  const settings = {};
  rows.forEach(s => settings[s.key] = s.value);

  const { buildHalfA4 } = require('./pdf');
  const doc = buildHalfA4(settings, r);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${r.receipt_number}-half.pdf"`);
  doc.pipe(res);
  doc.end();
});

module.exports = router;
