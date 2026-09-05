const express = require('express');
const cors = require('cors');
const path = require('path');
const { initDB, MASTER_UPLOADS } = require('./master-db');
const { tenantRoot } = require('./tenant-db');
const { migrateIfNeeded } = require('./migrate');
const routes = require('./routes');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use((req, res, next) => {
  if (req.path === '/' || /\.html$/i.test(req.path)) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
});
app.use(express.static(path.join(__dirname, '..', 'public'), { cacheControl: false }));
app.use('/uploads', express.static(tenantRoot));
app.use('/qris', express.static(MASTER_UPLOADS));
app.use('/api', routes);

app.get('/login', (req, res) => res.redirect('/'));
app.get(['/daftar', '/admin'], (req, res) => {
  const file = req.path === '/admin' ? 'admin.html' : 'register.html';
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.sendFile(path.join(__dirname, '..', 'public', file));
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

async function start() {
  await initDB();
  await migrateIfNeeded();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server berjalan di http://0.0.0.0:${PORT}`);
  });
}

start().catch(err => {
  console.error('Gagal memulai server:', err);
  process.exit(1);
});