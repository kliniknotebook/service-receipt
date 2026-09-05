const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const master = require('./master-db');

const tenantRoot = path.join(master.DATA_DIR, 'tenants');
if (!fs.existsSync(tenantRoot)) fs.mkdirSync(tenantRoot, { recursive: true });

let SQL = null;
const cache = new Map(); // tenantId -> { db, timer }
const saveQueued = new Set();

async function ensureSQL() {
  if (!SQL) SQL = await initSqlJs();
  return SQL;
}

function tenantDir(tenantId) {
  const dir = path.join(tenantRoot, tenantId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function tenantDbPath(tenantId) {
  return path.join(tenantDir(tenantId), 'receipts.db');
}

function save(tenantId) {
  const entry = cache.get(tenantId);
  if (!entry) return;
  const data = entry.db.export();
  fs.writeFileSync(tenantDbPath(tenantId), Buffer.from(data));
  if (entry.timer) clearTimeout(entry.timer);
  entry.timer = null;
}

function notifyWrite(tenantId) {
  const entry = cache.get(tenantId);
  if (!entry) return;
  if (saveQueued.has(tenantId)) return;
  saveQueued.add(tenantId);
  setTimeout(() => {
    saveQueued.delete(tenantId);
    save(tenantId);
  }, 200);
}

async function init(tenant) {
  await ensureSQL();
  const dbPath = tenantDbPath(tenant.id);
  const existing = fs.existsSync(dbPath) ? new Uint8Array(fs.readFileSync(dbPath)) : null;
  const db = existing ? new SQL.Database(existing) : new SQL.Database();

  db.run('PRAGMA journal_mode = WAL');
  db.run(`
    CREATE TABLE IF NOT EXISTS receipts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      receipt_number TEXT UNIQUE NOT NULL,
      customer_name TEXT NOT NULL,
      customer_phone TEXT,
      customer_address TEXT,
      device_type TEXT,
      device_brand TEXT,
      device_model TEXT,
      device_serial TEXT,
      complaint TEXT,
      notes TEXT,
      estimated_cost INTEGER DEFAULT 0,
      down_payment INTEGER DEFAULT 0,
      status TEXT DEFAULT 'diterima',
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime'))
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);

  const defaults = {
    shop_name: tenant.shop_name || 'Service Center',
    shop_address: '',
    shop_phone: '',
    shop_footer: 'Terima kasih atas kepercayaan Anda'
  };
  const stmt = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(defaults)) {
    stmt.bind([k, v]);
    stmt.step();
  }
  stmt.free();

  const entry = { db, timer: null };
  cache.set(tenant.id, entry);
  save(tenant.id);
  return entry;
}

function get(tenantId) {
  return cache.get(tenantId) || null;
}

function query(tenantId, sql, params = []) {
  const entry = get(tenantId);
  if (!entry) return [];
  const stmt = entry.db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function queryOne(tenantId, sql, params = []) {
  return query(tenantId, sql, params)[0] || null;
}

function run(tenantId, sql, params = []) {
  const entry = get(tenantId);
  if (!entry) return;
  entry.db.run(sql, params);
  notifyWrite(tenantId);
}

function uploadsDir(tenantId) {
  return path.join(tenantDir(tenantId), 'uploads');
}

module.exports = { init, get, query, queryOne, run, tenantRoot, uploadsDir, tenantDir, save };