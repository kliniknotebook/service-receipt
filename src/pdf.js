const PDFDocument = require('pdfkit');

function formatRupiah(n) {
  return 'Rp ' + Number(n || 0).toLocaleString('id-ID');
}

function statusLabel(status) {
  return (status || 'diterima').charAt(0).toUpperCase() + (status || 'diterima').slice(1);
}

function buildA4(settings, r, logoPath) {
  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  const remaining = (r.estimated_cost || 0) - (r.down_payment || 0);

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

  // Biaya
  doc.moveDown(0.5);
  doc.fontSize(11).fillColor('#000');
  doc.text('Estimasi Biaya   : ' + formatRupiah(r.estimated_cost), baseX, doc.y);
  doc.text('Uang Muka (DP)  : ' + formatRupiah(r.down_payment));
  doc.fontSize(12).fillColor('#000').text('Sisa Bayar       : ' + formatRupiah(remaining));
  doc.moveDown(0.5);
  doc.text('Status: ' + statusLabel(r.status));
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
  const remaining = (r.estimated_cost || 0) - (r.down_payment || 0);
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

  doc.moveDown(0.3);
  doc.fontSize(9).fillColor('#000');
  doc.text('Estimasi: ' + formatRupiah(r.estimated_cost), baseX, doc.y);
  doc.text('DP      : ' + formatRupiah(r.down_payment));
  doc.text('Sisa    : ' + formatRupiah(remaining));
  doc.text('Status  : ' + statusLabel(r.status));
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

module.exports = { buildA4, buildHalfA4 };
