const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const M = require('./master-db');
const T = require('./tenant-db');

const OLD_PATH = path.join(M.DATA_DIR, 'receipts.db');
const OLD_UPLOADS = path.join(M.DATA_DIR, 'uploads');

async function migrateIfNeeded() {
  if (!fs.existsSync(OLD_PATH)) return false;
  const existing = M.queryOne('SELECT COUNT(*) as c FROM tenants');
  if (existing && existing.c > 0) return false; // sudah ada data SaaS, skip

  const SQL = await initSqlJs();
  const oldDb = new SQL.Database(new Uint8Array(fs.readFileSync(OLD_PATH)));

  const rowsWhere = (sql) => {
    const stmt = oldDb.prepare(sql);
    const out = [];
    while (stmt.step()) out.push(stmt.getAsObject());
    stmt.free();
    return out;
  };

  const receipts = rowsWhere('SELECT * FROM receipts');
  const settingRows = rowsWhere('SELECT * FROM settings');
  const old = {};
  settingRows.forEach(r => { old[r.key] = r.value; });

  const shopName = (old.shop_name || 'Service Center').trim();
  const hasMeaningfulData = receipts.length > 0 || old.shop_logo || old.shop_name !== 'Service Center';
  if (!hasMeaningfulData) return false;

  const username = String(old.admin_username || 'kliniknotebook').trim().toLowerCase().replace(/[^a-z0-9._-]/g, '') || 'kliniknotebook';
  const password = old.admin_password || 'kiranaku125';
  const now = new Date();

  const id = M.genId('TEN');
  M.run(
    `INSERT INTO tenants (id, username, password, shop_name, phone, sub_end, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'active', ?)`,
    [id, username, password, shopName, old.shop_phone || '',
     new Date(now.getTime() + 30 * 86400000).toISOString().slice(0, 19).replace('T', ' '),
     now.toISOString().slice(0, 19).replace('T', ' ')]
  );
  const tenant = M.queryOne('SELECT * FROM tenants WHERE id = ?', [id]);
  await T.init(tenant);

  // Salin settings toko
  const settingKeys = ['shop_name', 'shop_address', 'shop_phone', 'shop_footer'];
  for (const k of settingKeys) {
    if (old[k]) T.run(id, 'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [k, old[k]]);
  }

  // Logo lama -> folder toko
  if (old.shop_logo) {
    const src = path.join(OLD_UPLOADS, path.basename(old.shop_logo));
    if (fs.existsSync(src)) {
      const dir = T.uploadsDir(id);
      fs.mkdirSync(dir, { recursive: true });
      const ext = path.extname(src) || '.png';
      fs.copyFileSync(src, path.join(dir, 'logo' + ext));
      T.run(id, 'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ['shop_logo', `/uploads/${id}/uploads/logo${ext}`]);
    }
  }

  // Salin tanda terima
  for (const r of receipts) {
    T.run(id, `
      INSERT INTO receipts
        (receipt_number, customer_name, customer_phone, customer_address,
         device_type, device_brand, device_model, device_serial,
         complaint, notes, estimated_cost, down_payment, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      r.receipt_number, r.customer_name, r.customer_phone || '', r.customer_address || '',
      r.device_type || '', r.device_brand || '', r.device_model || '', r.device_serial || '',
      r.complaint || '', r.notes || '', r.estimated_cost || 0, r.down_payment || 0,
      r.status || 'diterima', r.created_at || now.toISOString(), r.updated_at || r.created_at || now.toISOString()
    ]);
  }

  // Super admin ikut memakai kredensial lama (kalau masih default)
  const curAdminU = M.getSetting('admin_username');
  const curAdminP = M.getSetting('admin_password');
  if (!curAdminU || curAdminU === 'admin') M.setSetting('admin_username', old.admin_username || 'admin');
  if (!curAdminP || curAdminP === 'admin123') M.setSetting('admin_password', password);

  console.log(`[MIGRASI] data lama diimpor ke toko "${shopName}" (username: ${username}, password: <sama dengan sebelumnya>).`);
  return true;
}

module.exports = { migrateIfNeeded };