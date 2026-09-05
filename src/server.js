const express = require('express');
const cors = require('cors');
const path = require('path');
const { initDB } = require('./master-db');
const { tenantRoot } = require('./tenant-db');
const { migrateIfNeeded } = require('./migrate');
const routes = require('./routes');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/uploads', express.static(tenantRoot));
app.use('/api', routes);

app.get('/login', (req, res) => res.redirect('/'));
app.get('/daftar', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'register.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'admin.html')));

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