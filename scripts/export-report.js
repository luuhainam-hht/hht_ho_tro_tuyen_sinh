#!/usr/bin/env node
'use strict';
/** Xuất số liệu giai đoạn thử nghiệm ra XLSX cho báo cáo tổng kết:
 *   node scripts/export-report.js 2027-01-01 2027-04-30 bao-cao.xlsx */
const fs = require('node:fs');
const { createContainer } = require('../src/container');

(async () => {
  const [from = '2027-01-01', to = '2027-04-30', out = `bao-cao-thu-nghiem-${from}_${to}.xlsx`] = process.argv.slice(2);
  const c = createContainer({ logger: { info() {}, warn() {}, error: console.error } });
  await c.configService.loadAll();
  fs.writeFileSync(out, Buffer.from(await c.analyticsService.exportXlsx({ from, to })));
  console.log(`Đã xuất ${out}`);
  await c.db.end();
})().catch((e) => { console.error(e); process.exit(1); });
