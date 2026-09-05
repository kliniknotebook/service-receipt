const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const MASTER_PATH = path.join(DATA_DIR, 'master.db');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const MASTER_UPLOADS = path.join(DATA_DIR, 'master-uploads');
if (!fs.existsSync(MASTER_UPLOADS)) fs.mkdirSync(MASTER_UPLOADS, { recursive: true });

let db = null;
let saveTimer = null;

const DAY = 24 * 60 * 60 * 1000;

function nowIso() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function load() {
  if (fs.existsSync(MASTER_PATH)) {
    return new Uint8Array(fs.readFileSync(MASTER_PATH));
  }
  return null;
}

function save() {
  if (!db) return;
  const data = db.export();
  fs.writeFileSync(MASTER_PATH, Buffer.from(data));
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 200);
}

function run(sql, params = []) {
  db.run(sql, params);
  scheduleSave();
}

async function initDB() {
  const SQL = await initSqlJs();
  const existing = load();
  db = existing ? new SQL.Database(existing) : new SQL.Database();
  db.run('PRAGMA journal_mode = WAL');
  db.run(`
    CREATE TABLE IF NOT EXISTS tenants (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      shop_name TEXT NOT NULL,
      phone TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      trial_end TEXT,
      sub_end TEXT,
      status TEXT DEFAULT 'trial',
      note TEXT
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      amount INTEGER DEFAULT 0,
      note TEXT,
      proof TEXT,
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now','localtime')),
      confirmed_at TEXT
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);

  const defaults = {
    price: '50000',
    trial_days: '3',
    bank_name: process.env.BANK_NAME || 'BANK BCA',
    bank_account: process.env.BANK_ACCOUNT || '1234567890',
    bank_holder: process.env.BANK_HOLDER || 'Nama Pemilik',
    admin_username: process.env.ADMIN_USERNAME || 'admin',
    admin_password: process.env.ADMIN_PASSWORD || 'admin123'
  };
  for (const [k, v] of Object.entries(defaults)) {
    db.run('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', [k, v]);
  }
  save();
  return db;
}

function getDB() { return db; }

function query(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function queryOne(sql, params = []) {
  const rows = query(sql, params);
  return rows[0] || null;
}

function getSetting(key) {
  const r = queryOne('SELECT value FROM settings WHERE key = ?', [key]);
  return r ? r.value : '';
}

function setSetting(key, value) {
  run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, value]);
}

function genId(prefix) {
  return prefix + '-' + Math.random().toString(36).slice(2, 8).toUpperCase();
}

function addDaysIso(days) {
  return new Date(Date.now() + days * DAY).toISOString().slice(0, 19).replace('T', ' ');
}

function extendByDays(tenant, days) {
  const base = maxIso(tenant.sub_end, nowIso());
  const t = new Date(base).getTime() + days * DAY;
  const res = new Date(t).toISOString().slice(0, 19).replace('T', ' ');
  run('UPDATE tenants SET sub_end = ?, status = ? WHERE id = ?', [res, 'active', tenant.id]);
  return { ...tenant, sub_end: res, status: 'active' };
}

function maxIso(a, b) {
  if (!a) return b;
  if (!b) return a;
  return a >= b ? a : b;
}

// Status efektif berdasarkan tanggal
function effectiveStatus(t) {
  if (!t) return 'expired';
  if (t.status === 'suspended') return 'suspended';
  const end = maxIso(t.sub_end, t.trial_end);
  if (!end) return 'expired';
  if (new Date(end).getTime() >= Date.now()) {
    return t.sub_end ? 'active' : 'trial';
  }
  return 'expired';
}

module.exports = { initDB, getDB, query, queryOne, run, getSetting, setSetting, genId, addDaysIso, extendByDays, effectiveStatus, maxIso, DATA_DIR, MASTER_UPLOADS, nowIso };