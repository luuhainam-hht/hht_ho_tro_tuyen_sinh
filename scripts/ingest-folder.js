#!/usr/bin/env node
'use strict';
/**
 * Nạp hàng loạt văn bản từ một thư mục vào kho tri thức (trạng thái READY, chờ Lãnh đạo công bố):
 *   node scripts/ingest-folder.js <thư-mục> [--username=admin]
 */
const fs = require('node:fs');
const path = require('node:path');
const { createContainer } = require('../src/container');
const { mimeFromName } = require('../src/services/rag/extractor');

(async () => {
  const dir = process.argv[2];
  const username = (process.argv.find((a) => a.startsWith('--username=')) || '--username=admin').split('=')[1];
  if (!dir) { console.error('Cách dùng: node scripts/ingest-folder.js <thư-mục>'); process.exit(1); }
  const c = createContainer({ logger: { info() {}, warn: console.warn, error: console.error } });
  await c.configService.loadAll();
  const { rows } = await c.db.query('SELECT id, username, role FROM staff WHERE username = ?', [username]);
  if (!rows[0]) throw new Error(`Không có tài khoản ${username}`);
  for (const name of fs.readdirSync(dir)) {
    if (!mimeFromName(name)) continue;
    const buffer = fs.readFileSync(path.join(dir, name));
    try {
      const doc = await c.kbService.upload({ file: { originalname: name, size: buffer.length, buffer }, meta: { title: path.parse(name).name }, actor: rows[0], ip: 'cli' });
      const r = await c.ingestService.processDocument(Number(doc.id));
      console.log(`✓ ${name}: ${r.chunks} đoạn${r.embedded ? ', có vector' : ''}`);
    } catch (e) { console.log(`✗ ${name}: ${e.message}`); }
  }
  await c.db.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
