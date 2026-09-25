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
  const cached = cache.get(tenant.id);
  if (cached) return cached;
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
      delivery_note TEXT DEFAULT '',
      discount_type TEXT DEFAULT '',
      discount_value REAL DEFAULT 0,
      discount_note TEXT DEFAULT '',
      estimated_cost INTEGER DEFAULT 0,
      down_payment INTEGER DEFAULT 0,
      status TEXT DEFAULT 'diterima',
      payment_status TEXT DEFAULT 'cash',
      due_date TEXT,
      settle_date TEXT DEFAULT '',
      settle_method TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime')),
      client_id TEXT,
      deleted INTEGER DEFAULT 0
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id TEXT UNIQUE,
      name TEXT NOT NULL,
      category TEXT DEFAULT '',
      price REAL DEFAULT 0,
      hpp REAL DEFAULT 0,
      stock REAL DEFAULT 0,
      supplier TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime')),
      synced_at TEXT,
      deleted INTEGER DEFAULT 0
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id TEXT UNIQUE,
      name TEXT NOT NULL,
      phone TEXT DEFAULT '',
      address TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime')),
      synced_at TEXT,
      deleted INTEGER DEFAULT 0
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_number TEXT UNIQUE NOT NULL,
      customer_name TEXT DEFAULT '',
      customer_phone TEXT DEFAULT '',
      items TEXT DEFAULT '[]',
      subtotal REAL DEFAULT 0,
      discount_type TEXT DEFAULT '',
      discount_value REAL DEFAULT 0,
      discount_note TEXT DEFAULT '',
      total REAL DEFAULT 0,
      paid REAL DEFAULT 0,
      change_amount REAL DEFAULT 0,
      payment_status TEXT DEFAULT 'lunas',
      settle_method TEXT DEFAULT 'cash',
      due_date TEXT DEFAULT '',
      settle_date TEXT DEFAULT '',
      date TEXT DEFAULT (date('now','localtime')),
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime')),
      client_id TEXT UNIQUE,
      synced_at TEXT,
      deleted INTEGER DEFAULT 0
    )
  `);

  // Migrasi backward-compatible: tambah kolom sync bila DB lama belum punya
  const cols = db.exec('PRAGMA table_info(receipts)')[0]?.values.map(r => r[1]) || [];
  if (!cols.includes('client_id')) db.run('ALTER TABLE receipts ADD COLUMN client_id TEXT');
  if (!cols.includes('deleted')) db.run('ALTER TABLE receipts ADD COLUMN deleted INTEGER DEFAULT 0');
  // Migrasi pembayaran
  if (!cols.includes('payment_status')) db.run("ALTER TABLE receipts ADD COLUMN payment_status TEXT DEFAULT 'cash'");
  if (!cols.includes('due_date')) db.run('ALTER TABLE receipts ADD COLUMN due_date TEXT');
  // Migrasi pelunasan hutang (Lunas)
  if (!cols.includes('settle_date')) db.run("ALTER TABLE receipts ADD COLUMN settle_date TEXT DEFAULT ''");
  if (!cols.includes('settle_method')) db.run("ALTER TABLE receipts ADD COLUMN settle_method TEXT DEFAULT ''");
  // Migrasi keterangan Diantar (barang dikirim ke pelanggan)
  if (!cols.includes('delivery_note')) db.run("ALTER TABLE receipts ADD COLUMN delivery_note TEXT DEFAULT ''");
  // Migrasi diskon (Rp / %) + keterangan event/promo
  if (!cols.includes('discount_type')) db.run("ALTER TABLE receipts ADD COLUMN discount_type TEXT DEFAULT ''");
  if (!cols.includes('discount_value')) db.run('ALTER TABLE receipts ADD COLUMN discount_value REAL DEFAULT 0');
  if (!cols.includes('discount_note')) db.run("ALTER TABLE receipts ADD COLUMN discount_note TEXT DEFAULT ''");

  // Migrasi HPP (harga beli) produk
  const pcols = db.exec('PRAGMA table_info(products)')[0]?.values.map(r => r[1]) || [];
  if (!pcols.includes('hpp')) db.run('ALTER TABLE products ADD COLUMN hpp REAL DEFAULT 0');
  // Migrasi Pemasok (toko tempat beli stok)
  if (!pcols.includes('supplier')) db.run("ALTER TABLE products ADD COLUMN supplier TEXT DEFAULT ''");

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

function remove(tenantId) {
  const entry = cache.get(tenantId);
  if (entry && entry.db) {
    try { entry.db.close(); } catch (e) {}
    if (entry.timer) clearTimeout(entry.timer);
  }
  cache.delete(tenantId);
  saveQueued.delete(tenantId);
  try {
    fs.rmSync(tenantDir(tenantId), { recursive: true, force: true });
  } catch (e) {}
}

module.exports = { init, get, query, queryOne, run, tenantRoot, uploadsDir, tenantDir, save, remove };