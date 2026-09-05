const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'receipts.db');
const dir = path.dirname(dbPath);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

let db = null;

function loadExistingDB() {
  if (fs.existsSync(dbPath)) {
    const buf = fs.readFileSync(dbPath);
    return new Uint8Array(buf);
  }
  return null;
}

function saveDB() {
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(dbPath, buffer);
}

async function initDB() {
  const SQL = await initSqlJs();
  const existing = loadExistingDB();
  db = existing ? new SQL.Database(existing) : new SQL.Database();

  db.run('PRAGMA journal_mode = WAL');
  db.run('PRAGMA foreign_keys = ON');

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

  const settingsDefault = {
    shop_name: 'Service Center',
    shop_address: '',
    shop_phone: '',
    shop_footer: 'Terima kasih atas kepercayaan Anda',
    admin_username: 'admin',
    admin_password: 'admin123'
  };

  for (const [key, value] of Object.entries(settingsDefault)) {
    db.run('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', [key, value]);
  }

  saveDB();
  return db;
}

function getDB() {
  return db;
}

module.exports = { initDB, getDB, saveDB };
