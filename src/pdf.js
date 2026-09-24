const PDFDocument = require('pdfkit');

function formatRupiah(n) {
  return 'Rp ' + Number(n || 0).toLocaleString('id-ID');
}

function statusLabel(status) {
  return (status || 'diterima').charAt(0).toUpperCase() + (status || 'diterima').slice(1);
}

function discountAmount(r) {
  const est = Number((r && r.estimated_cost) || 0);
  const v = Number((r && r.discount_value) || 0);
  const t = (r && r.discount_type) || '';
  if (t === 'percent') return Math.round(est * v / 100);
  if (t === 'rp') return Math.round(v);
  return 0;
}

function buildA4(settings, r, logoPath) {
  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  const remaining = (r.payment_status || '') === 'lunas' ? 0 : (r.estimated_cost || 0) - discountAmount(r) - (r.down_payment || 0);

  // Header
  if (logoPath) {
    try {
      const img = doc.openImage(logoPath);
      doc.image(logoPath, 40, doc.y, { width: 70 });
      doc.y += 70 * (img.height / img.width);
    } catch (e) {}
    doc.moveDown(0.5);
  }
  doc.fontSize(20).fillColor('#2563eb').text(settings.shop_name || 'Service Center', { align: 'left' });
  doc.fontSize(10).fillColor('#444');
  if (settings.shop_address) doc.text(settings.shop_address);
  if (settings.shop_phone) doc.text('Telp: ' + settings.shop_phone);
  doc.moveDown(0.5);
  doc.moveTo(40, doc.y).lineTo(555, doc.y).lineWidth(2).stroke();
  doc.moveDown(0.8);

  doc.fontSize(16).fillColor('#000').text('TANDA TERIMA SERVICE', { align: 'center' });
  doc.moveDown(0.3);
  doc.fontSize(11);
  doc.text('No: ' + r.receipt_number, { align: 'center' });
  doc.text('Tanggal: ' + (r.created_at || ''), { align: 'center' });
  doc.moveDown(1);

  // Tables helper
  const baseX = 40;
  const width = 515;
  const labelW = 90;
  let y = doc.y;

  function field(x, w, label, value) {
    doc.fontSize(10);
    doc.fillColor('#555').text(label + ': ', x, y);
    const labelTw = doc.widthOfString(label + ': ');
    doc.fillColor('#000').text(value || '-', x + labelTw, y, { width: w - labelTw });
    y = doc.y + 4;
  }

  function sectionTitle(title) {
    doc.moveDown(0.5);
    doc.fillColor('#2563eb').fontSize(11).text(title);
    doc.moveDown(0.3);
    y = doc.y;
  }

  // Baris pelanggan & perangkat (dua kolom)
  doc.moveDown(0.3);
  doc.fillColor('#2563eb').fontSize(11).text('DATA PELANGGAN');
  y = doc.y;
  field(baseX, width / 2 - 10, 'Nama', r.customer_name);
  field(baseX, width / 2 - 10, 'Telepon', r.customer_phone);
  field(baseX, width / 2 - 10, 'Alamat', r.customer_address);
  doc.moveDown(0.8);

  doc.fillColor('#2563eb').fontSize(11).text('DATA PERANGKAT');
  y = doc.y;
  field(baseX, width / 2 - 10, 'Jenis', r.device_type);
  field(baseX, width / 2 - 10, 'Merek', r.device_brand);
  field(baseX, width / 2 - 10, 'Model', r.device_model);
  field(baseX, width / 2 - 10, 'S/N / IMEI', r.device_serial);
  doc.moveDown(0.8);

  sectionTitle('KELUHAN / KERUSAKAN');
  doc.fillColor('#000').fontSize(10).text(r.complaint || '-', baseX, y, { width: width });
  doc.moveDown(0.8);

  if (r.notes) {
    sectionTitle('CATATAN TEKNISI');
    doc.fillColor('#000').fontSize(10).text(r.notes, baseX, y, { width: width });
    doc.moveDown(0.8);
  }

  if (r.delivery_note) {
    sectionTitle('KETERANGAN DIANTAR');
    doc.fillColor('#000').fontSize(10).text(r.delivery_note, baseX, y, { width: width });
    doc.moveDown(0.8);
  }

  // Biaya
  doc.moveDown(0.5);
  doc.fontSize(11).fillColor('#000');
  doc.text('Estimasi Biaya   : ' + formatRupiah(r.estimated_cost), baseX, doc.y);
  doc.text('Uang Muka (DP)  : ' + formatRupiah(r.down_payment));
  if (discountAmount(r)) {
    doc.text('Diskon' + (r.discount_note ? ' (' + r.discount_note + ')' : '') + ' : ' + formatRupiah(discountAmount(r)));
  }
  doc.fontSize(12).fillColor('#000').text('Sisa Bayar       : ' + formatRupiah(remaining));
  doc.moveDown(0.5);
  doc.text('Status: ' + statusLabel(r.status));
const payText = (r.payment_status || '') === 'hutang'
  ? 'Hutang' + (r.due_date ? ' (jatuh tempo ' + r.due_date + ')' : '')
  : (r.payment_status || '') === 'lunas'
    ? 'Lunas' + (r.settle_method ? ' (' + (r.settle_method === 'transfer' ? 'Transfer Bank' : (r.settle_method === 'qris' ? 'QRIS' : 'Cash')) + ')' : '')
      + (r.settle_date ? ' ' + r.settle_date : '')
  : (r.payment_status || '') === 'cash' ? 'Cash' : 'Kosong';
  doc.text('Bayar  : ' + payText);
  doc.moveDown(1.5);

  // Tanda tangan
  const signY = doc.y;
  doc.fontSize(10).fillColor('#000');
  doc.text('Petugas / Teknisi', baseX, signY, { align: 'center', width: 200 });
  doc.text('Diterima Oleh (Pelanggan)', baseX + 315, signY, { align: 'center', width: 200 });
  doc.moveDown(3);
  doc.fontSize(10).text('( ...................... )', baseX, doc.y, { align: 'center', width: 200 });
  doc.text('( ...................... )', baseX + 315, doc.y - doc.currentLineHeight(), { align: 'center', width: 200 });

  doc.moveDown(1.5);
  const footerY = doc.y;
  doc.moveTo(40, footerY).lineTo(555, footerY).lineWidth(1).stroke();
  doc.moveDown(0.4);
  doc.fontSize(10).fillColor('#333').text(settings.shop_footer || 'Terima kasih atas kepercayaan Anda', { align: 'center' });

  return doc;
}

function buildHalfA4(settings, r, logoPath) {
  // Half Letter: 139.7 x 215.9 mm => points (1mm=2.835): 396 x 612
  const doc = new PDFDocument({ size: [396, 612], margin: 25 });
  const remaining = (r.payment_status || '') === 'lunas' ? 0 : (r.estimated_cost || 0) - discountAmount(r) - (r.down_payment || 0);
  const width = 346;
  const baseX = 25;

  if (logoPath) {
    try {
      const img = doc.openImage(logoPath);
      doc.image(logoPath, baseX, doc.y, { width: 40 });
      doc.y += 40 * (img.height / img.width);
    } catch (e) {}
    doc.moveDown(0.5);
  }
  doc.fontSize(14).fillColor('#2563eb').text(settings.shop_name || 'Service Center');
  doc.fontSize(8).fillColor('#444');
  if (settings.shop_address) doc.text(settings.shop_address);
  if (settings.shop_phone) doc.text('Telp: ' + settings.shop_phone);
  doc.moveDown(0.3);
  doc.moveTo(baseX, doc.y).lineTo(baseX + width, doc.y).lineWidth(1.5).stroke();
  doc.moveDown(0.5);
  doc.fontSize(11).fillColor('#000').text('TANDA TERIMA SERVICE', { align: 'center' });
  doc.fontSize(8).text('No: ' + r.receipt_number, { align: 'center' });
  doc.text('Tanggal: ' + (r.created_at || ''), { align: 'center' });
  doc.moveDown(0.8);

  let y = doc.y;
  function field(lineLabel, value) {
    doc.fontSize(8);
    doc.fillColor('#555').text(lineLabel, baseX, y);
    const tw = doc.widthOfString(lineLabel);
    doc.text(value || '-', baseX + tw, y, { width: width - tw });
    doc.fillColor('#000');
    y = doc.y = Math.max(doc.y, y + 12);
  }

  function section(t) {
    doc.moveDown(0.4);
    doc.fillColor('#2563eb').fontSize(9).text(t);
    doc.moveDown(0.2);
    y = doc.y;
  }

  section('DATA PELANGGAN');
  field('Nama   : ', r.customer_name);
  field('Telp   : ', r.customer_phone);
  field('Alamat : ', r.customer_address);
  doc.moveDown(0.3);

  section('DATA PERANGKAT');
  field('Jenis : ', r.device_type);
  field('Merek : ', r.device_brand);
  field('Model : ', r.device_model);
  field('S/N   : ', r.device_serial);
  doc.moveDown(0.3);

  section('KELUHAN / KERUSAKAN');
  doc.fillColor('#000').fontSize(8).text(r.complaint || '-', baseX, y, { width: width });
  doc.moveDown(0.4);

  if (r.notes) {
    section('CATATAN TEKNISI');
    doc.fillColor('#000').fontSize(8).text(r.notes, baseX, y, { width: width });
    doc.moveDown(0.4);
  }

  if (r.delivery_note) {
    section('KETERANGAN DIANTAR');
    doc.fillColor('#000').fontSize(8).text(r.delivery_note, baseX, y, { width: width });
    doc.moveDown(0.4);
  }

  doc.moveDown(0.3);
  doc.fontSize(9).fillColor('#000');
  doc.text('Estimasi: ' + formatRupiah(r.estimated_cost), baseX, doc.y);
  doc.text('DP      : ' + formatRupiah(r.down_payment));
  if (discountAmount(r)) {
    doc.text('Diskon' + (r.discount_note ? ' (' + r.discount_note + ')' : '') + ': ' + formatRupiah(discountAmount(r)));
  }
  doc.text('Sisa    : ' + formatRupiah(remaining));
  doc.text('Status  : ' + statusLabel(r.status));
const payTextHalf = (r.payment_status || '') === 'hutang'
  ? 'Hutang' + (r.due_date ? ' (jatuh tempo ' + r.due_date + ')' : '')
  : (r.payment_status || '') === 'lunas'
    ? 'Lunas' + (r.settle_method ? ' (' + (r.settle_method === 'transfer' ? 'Transfer Bank' : (r.settle_method === 'qris' ? 'QRIS' : 'Cash')) + ')' : '')
      + (r.settle_date ? ' ' + r.settle_date : '')
  : (r.payment_status || '') === 'cash' ? 'Cash' : 'Kosong';
  doc.text('Bayar   : ' + payTextHalf);
  doc.moveDown(1.2);

  const signY = doc.y;
  doc.fontSize(8);
  doc.text('Petugas / Teknisi', baseX, signY, { align: 'center', width: width / 2 });
  doc.text('Diterima Oleh (Pelanggan)', baseX + width / 2, signY, { align: 'center', width: width / 2 });
  doc.moveDown(2.2);
  doc.text('( ................. )', baseX, doc.y, { align: 'center', width: width / 2 });
  doc.text('( ................. )', baseX + width / 2, doc.y - doc.currentLineHeight(), { align: 'center', width: width / 2 });

  doc.moveDown(1);
  doc.moveTo(baseX, doc.y).lineTo(baseX + width, doc.y).lineWidth(1).stroke();
  doc.moveDown(0.3);
  doc.fontSize(8).fillColor('#333').text(settings.shop_footer || 'Terima kasih atas kepercayaan Anda', { align: 'center' });

  return doc;
}

// ---------- Modul Kasir: Struk Penjualan ----------
function parseSaleItems(s) {
  try { return JSON.parse(s.items || '[]'); } catch (e) { return []; }
}

function salePayLabel(s) {
  if ((s.payment_status || '') === 'hutang') {
    return 'Hutang' + (s.due_date ? ' (jatuh tempo ' + s.due_date + ')' : '');
  }
  const via = s.settle_method === 'transfer' ? 'Transfer Bank' : (s.settle_method === 'qris' ? 'QRIS' : 'Cash');
  return 'Lunas' + (s.settle_method ? ' (' + via + ')' : '') + (s.settle_date ? ' ' + s.settle_date : '');
}

function buildSaleStruk(settings, s, logoPath) {
  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  const items = parseSaleItems(s);
  const change = Number(s.change_amount) || 0;
  const outstanding = Number(s.total) - Number(s.paid);

  if (logoPath) {
    try {
      const img = doc.openImage(logoPath);
      doc.image(logoPath, 40, doc.y, { width: 70 });
      doc.y += 70 * (img.height / img.width);
    } catch (e) {}
    doc.moveDown(0.5);
  }
  doc.fontSize(20).fillColor('#2563eb').text(settings.shop_name || 'Toko', { align: 'left' });
  doc.fontSize(10).fillColor('#444');
  if (settings.shop_address) doc.text(settings.shop_address);
  if (settings.shop_phone) doc.text('Telp: ' + settings.shop_phone);
  doc.moveDown(0.5);
  doc.moveTo(40, doc.y).lineTo(555, doc.y).lineWidth(2).stroke();
  doc.moveDown(0.8);

  doc.fontSize(16).fillColor('#000').text('STRUK PENJUALAN', { align: 'center' });
  doc.moveDown(0.3);
  doc.fontSize(11);
  doc.text('No: ' + s.sale_number, { align: 'center' });
  doc.text('Tanggal: ' + (s.date || s.created_at || ''), { align: 'center' });
  doc.moveDown(1);

  doc.fillColor('#2563eb').fontSize(11).text('DATA PELANGGAN');
  doc.moveDown(0.2);
  doc.fontSize(10).fillColor('#000');
  doc.text('Nama   : ' + (s.customer_name || '-'));
  doc.text('Telepon: ' + (s.customer_phone || '-'));
  doc.moveDown(0.8);

  doc.fillColor('#2563eb').fontSize(11).text('RINCIAN BARANG');
  doc.moveDown(0.2);
  const baseX = 40;
  const width = 515;
  let y = doc.y;
  doc.fontSize(10).fillColor('#333');
  doc.text('Barang', baseX, y);
  doc.text('Qty', baseX + 300, y, { width: 40, align: 'center' });
  doc.text('Harga', baseX + 340, y, { width: 110, align: 'right' });
  doc.text('Subtotal', baseX + 450, y, { width: 105, align: 'right' });
  y += 14;
  doc.moveTo(baseX, y).lineTo(baseX + width, y).lineWidth(0.5).stroke();
  y += 6;
  for (const it of items) {
    doc.fillColor('#000').fontSize(10);
    doc.text(String(it.name || '-'), baseX, y, { width: 290 });
    const qty = Number(it.qty) || 0;
    const price = Number(it.price) || 0;
    doc.text(String(qty), baseX + 300, y, { width: 40, align: 'center' });
    doc.text(formatRupiah(price), baseX + 340, y, { width: 110, align: 'right' });
    doc.text(formatRupiah(qty * price), baseX + 450, y, { width: 105, align: 'right' });
    y = doc.y + 4;
  }
  y += 4;
  doc.moveTo(baseX, y).lineTo(baseX + width, y).lineWidth(0.5).stroke();
  y += 8;
  doc.y = y;

  doc.fontSize(10).fillColor('#000');
  doc.text('Subtotal      : ' + formatRupiah(s.subtotal), baseX, doc.y);
  const disc = Number(s.discount_value) || 0;
  if (disc) {
    const discRp = s.discount_type === 'percent'
      ? Math.round((Number(s.subtotal) || 0) * disc / 100) : disc;
    doc.text('Diskon' + (s.discount_note ? ' (' + s.discount_note + ')' : '') + ' : ' + formatRupiah(discRp));
  }
  doc.fontSize(12).text('Total         : ' + formatRupiah(s.total));
  doc.fontSize(10);
  doc.text('Dibayar       : ' + formatRupiah(s.paid));
  if (change > 0) doc.text('Kembalian     : ' + formatRupiah(change));
  if ((s.payment_status || '') === 'hutang') doc.text('Sisa Hutang   : ' + formatRupiah(outstanding));
  doc.text('Bayar Via     : ' + salePayLabel(s));
  doc.moveDown(1.5);

  const signY = doc.y;
  doc.fontSize(10).fillColor('#000');
  doc.text('Petugas / Kasir', baseX, signY, { align: 'center', width: 200 });
  doc.text('Pembeli', baseX + 315, signY, { align: 'center', width: 200 });
  doc.moveDown(3);
  doc.text('( ...................... )', baseX, doc.y, { align: 'center', width: 200 });
  doc.text('( ...................... )', baseX + 315, doc.y - doc.currentLineHeight(), { align: 'center', width: 200 });

  doc.moveDown(1.5);
  const footerY = doc.y;
  doc.moveTo(40, footerY).lineTo(555, footerY).lineWidth(1).stroke();
  doc.moveDown(0.4);
  doc.fontSize(10).fillColor('#333').text(settings.shop_footer || 'Terima kasih', { align: 'center' });

  return doc;
}

function buildSaleStrukHalf(settings, s, logoPath) {
  // Half Letter: 396 x 612 points
  const doc = new PDFDocument({ size: [396, 612], margin: 25 });
  const items = parseSaleItems(s);
  const change = Number(s.change_amount) || 0;
  const outstanding = Number(s.total) - Number(s.paid);
  const width = 346;
  const baseX = 25;

  if (logoPath) {
    try {
      const img = doc.openImage(logoPath);
      doc.image(logoPath, baseX, doc.y, { width: 40 });
      doc.y += 40 * (img.height / img.width);
    } catch (e) {}
    doc.moveDown(0.5);
  }
  doc.fontSize(14).fillColor('#2563eb').text(settings.shop_name || 'Toko');
  doc.fontSize(8).fillColor('#444');
  if (settings.shop_address) doc.text(settings.shop_address);
  if (settings.shop_phone) doc.text('Telp: ' + settings.shop_phone);
  doc.moveDown(0.3);
  doc.moveTo(baseX, doc.y).lineTo(baseX + width, doc.y).lineWidth(1.5).stroke();
  doc.moveDown(0.5);
  doc.fontSize(11).fillColor('#000').text('STRUK PENJUALAN', { align: 'center' });
  doc.fontSize(8).text('No: ' + s.sale_number, { align: 'center' });
  doc.text('Tanggal: ' + (s.date || s.created_at || ''), { align: 'center' });
  doc.moveDown(0.6);

  doc.fontSize(9).fillColor('#2563eb').text('DATA PELANGGAN');
  doc.moveDown(0.2);
  doc.fontSize(8).fillColor('#000');
  doc.text('Nama   : ' + (s.customer_name || '-'));
  doc.text('Telepon: ' + (s.customer_phone || '-'));
  doc.moveDown(0.5);

  doc.fontSize(9).fillColor('#2563eb').text('RINCIAN BARANG');
  doc.moveDown(0.2);
  let y = doc.y;
  doc.fontSize(8).fillColor('#333');
  doc.text('Barang', baseX, y);
  doc.text('Qty', baseX + 200, y, { width: 25, align: 'center' });
  doc.text('Harga', baseX + 225, y, { width: 60, align: 'right' });
  doc.text('Subtotal', baseX + 285, y, { width: 61, align: 'right' });
  y += 11;
  doc.moveTo(baseX, y).lineTo(baseX + width, y).lineWidth(0.5).stroke();
  y += 5;
  for (const it of items) {
    doc.fillColor('#000').fontSize(8);
    doc.text(String(it.name || '-'), baseX, y, { width: 195 });
    const qty = Number(it.qty) || 0;
    const price = Number(it.price) || 0;
    doc.text(String(qty), baseX + 200, y, { width: 25, align: 'center' });
    doc.text(formatRupiah(price), baseX + 225, y, { width: 60, align: 'right' });
    doc.text(formatRupiah(qty * price), baseX + 285, y, { width: 61, align: 'right' });
    y = doc.y + 3;
  }
  y += 4;
  doc.moveTo(baseX, y).lineTo(baseX + width, y).lineWidth(0.5).stroke();
  y += 7;
  doc.y = y;

  doc.fontSize(9).fillColor('#000');
  doc.text('Subtotal      : ' + formatRupiah(s.subtotal), baseX, doc.y);
  const disc = Number(s.discount_value) || 0;
  if (disc) {
    const discRp = s.discount_type === 'percent'
      ? Math.round((Number(s.subtotal) || 0) * disc / 100) : disc;
    doc.text('Diskon' + (s.discount_note ? ' (' + s.discount_note + ')' : '') + ' : ' + formatRupiah(discRp));
  }
  doc.fontSize(10).text('Total         : ' + formatRupiah(s.total));
  doc.fontSize(9);
  doc.text('Dibayar       : ' + formatRupiah(s.paid));
  if (change > 0) doc.text('Kembalian     : ' + formatRupiah(change));
  if ((s.payment_status || '') === 'hutang') doc.text('Sisa Hutang   : ' + formatRupiah(outstanding));
  doc.text('Bayar Via     : ' + salePayLabel(s));
  doc.moveDown(1);

  const signY = doc.y;
  doc.fontSize(8);
  doc.text('Petugas / Kasir', baseX, signY, { align: 'center', width: width / 2 });
  doc.text('Pembeli', baseX + width / 2, signY, { align: 'center', width: width / 2 });
  doc.moveDown(2.2);
  doc.text('( ................. )', baseX, doc.y, { align: 'center', width: width / 2 });
  doc.text('( ................. )', baseX + width / 2, doc.y - doc.currentLineHeight(), { align: 'center', width: width / 2 });

  doc.moveDown(1);
  doc.moveTo(baseX, doc.y).lineTo(baseX + width, doc.y).lineWidth(1).stroke();
  doc.moveDown(0.3);
  doc.fontSize(8).fillColor('#333').text(settings.shop_footer || 'Terima kasih', { align: 'center' });

  return doc;
}

module.exports = { buildA4, buildHalfA4, buildSaleStruk, buildSaleStrukHalf };
