#!/usr/bin/env node
'use strict';
/**
 * Chuyển file Excel "HHT_du_lieu_chatbot_tuyen_sinh.xlsx" (do nhóm đề tài thu thập) thành
 * db/seed/*.json. Seed JSON được commit vào kho mã -> khởi động không cần file Excel,
 * và mọi thay đổi dữ liệu đều xem được qua git diff.
 *
 *   node scripts/import-excel.js <đường-dẫn.xlsx>
 *
 * Quy tắc theo sheet "Báo cáo": câu hỏi độ tin cậy A, B, D được duyệt sẵn (D chỉ hướng dẫn
 * liên hệ, không có số liệu); C (mâu thuẫn nguồn) nạp ở trạng thái DRAFT chờ Lãnh đạo duyệt.
 */
const fs = require('node:fs');
const path = require('node:path');
const ExcelJS = require('exceljs');

const OUT_DIR = path.join(__dirname, '..', 'db', 'seed');

const text = (v) => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object' && v.richText) return v.richText.map((r) => r.text).join('');
  if (typeof v === 'object' && v.text) return String(v.text);
  if (typeof v === 'object' && v.result !== undefined) return String(v.result);
  return String(v).trim();
};

function rows(ws) {
  const out = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const values = [];
    for (let c = 1; c <= ws.columnCount; c += 1) values.push(text(row.getCell(c).value));
    out.push(values);
  });
  return out;
}

const TOPIC_CODES = {
  'Giới thiệu trường': 'GIOI_THIEU',
  'Tuyển sinh chung': 'TUYEN_SINH',
  'Học phí & hỗ trợ': 'HOC_PHI',
  'Hồ sơ & thủ tục': 'HO_SO',
  'Thời gian tuyển sinh': 'LICH',
  'Hệ 9+ (THPT + Cao đẳng)': 'HE_9_PLUS',
  'Liên thông': 'LIEN_THONG',
  'Đối tượng đặc biệt': 'DOI_TUONG_DAC_BIET',
  'Hệ đặt hàng doanh nghiệp': 'DAT_HANG_DN',
  'Ngắn hạn, du học, khác': 'NGAN_HAN_KHAC',
  'Ký túc xá': 'KTX',
  'Liên hệ': 'LIEN_HE',
};

function importFaq(ws) {
  return rows(ws).slice(1).filter((r) => /^Q\d+$/.test(r[0])).map((r) => {
    const [code, topic, question, variants, answer, appliesTo, sources, reliability, note] = r;
    return {
      code,
      topic: TOPIC_CODES[topic] || 'KHAC',
      topicLabel: topic,
      question,
      variants: variants.split('|').map((s) => s.trim()).filter(Boolean),
      answer,
      appliesTo,
      sourceCodes: [...new Set((sources.match(/S\d{2}/g) || []))],
      reliability,
      status: reliability === 'C' ? 'DRAFT' : 'APPROVED',
      internalNote: note || null,
    };
  });
}

const LEVEL_COLUMNS_03 = { 3: 'HE_9_PLUS', 4: 'TRUNG_CAP', 5: 'CAO_DANG', 6: 'SO_CAP' };
const LEVEL_COLUMNS_08 = { 9: 'TRUNG_CAP', 10: 'CAO_DANG', 11: 'SO_CAP' };

function slugify(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd')
    .toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
}

function importMajors(ws) {
  const data = rows(ws).slice(2).filter((r) => r[0] && r[2] && !/^Tổng/.test(r[2]) && !/^Ghi chú/.test(r[0]));
  const seen = new Set();
  return data.map((r) => {
    const rawCode = r[1];
    const occupation = (rawCode.match(/\d{7}/g) || []).pop() || null; // "5810102 / 6810103" -> mã mới nhất
    let code = occupation && !seen.has(occupation) ? occupation : `N-${slugify(r[2])}`;
    seen.add(code);
    const levels = Object.entries(LEVEL_COLUMNS_03).filter(([i]) => r[i] === 'x').map(([, l]) => l);
    const levels08 = Object.entries(LEVEL_COLUMNS_08).filter(([i]) => r[i] === 'x').map(([, l]) => l);
    const cs1 = Number.parseInt(r[14], 10);
    const cs2 = Number.parseInt(r[15], 10);
    if ((cs1 || cs2) && !levels.includes('HE_9_PLUS')) levels.unshift('HE_9_PLUS'); // thông báo 9+ (S02) có chỉ tiêu
    const in08 = levels08.length > 0 || r[12] || r[13];
    return {
      code,
      occupationCode: occupation,
      name: r[2],
      faculty: r[0],
      levels,
      levels082026: levels08,
      listedIn082026: Boolean(in08),
      stateSupport032026: r[7] || null,
      enterpriseSupport032026: r[8] || null,
      stateSupport082026: r[12] || null,
      enterpriseSupport082026: r[13] || null,
      quota9PlusCs1: Number.isFinite(cs1) ? cs1 : null,
      quota9PlusCs2: Number.isFinite(cs2) ? cs2 : null,
      internalNote: r[16] || null,
      sourceCodes: ['S01', 'S05', ...(cs1 || cs2 ? ['S02'] : [])],
    };
  });
}

// Mã giấy tờ cố định để checklist, đặt hẹn và thống kê "giấy hay thiếu" dùng chung.
const DOC_CODES = [
  ['PHIEU_DANG_KY', /^Phiếu đăng ký/],
  ['SO_YEU_LY_LICH', /^Sơ yếu lý lịch/],
  ['HOC_BA', /^Học bạ/],
  ['BANG_TOT_NGHIEP', /^Bằng tốt nghiệp/],
  ['GIAY_KHAI_SINH', /^Giấy khai sinh/],
  ['CCCD', /^Căn cước/],
  ['GIAY_TO_UU_TIEN', /^Giấy tờ ưu tiên/],
  ['ANH_THE', /^Ảnh thẻ/],
  ['XAC_NHAN_NHAN_SU', /^Giấy xác nhận nhân sự/],
  ['TAM_TRU', /^Phiếu tạm trú/],
  ['THE_HOC_NGHE', /^Thẻ học nghề/],
  ['QUYET_DINH_XUAT_NGU', /^Quyết định xuất ngũ/],
];
const AUDIENCES = [['CHINH_QUY', 1, 'S01'], ['HE_9_PLUS', 2, 'S02'], ['BO_DOI', 3, 'S03']];

function classifyDoc(detail, title = '') {
  if (!detail || detail === '—' || /^Thông báo không ghi/.test(detail)) return null;
  const optional = /nếu có|^Chỉ với/i.test(detail) || /nếu có/i.test(title);
  let copyType = 'ORIGINAL';
  if (/bản sao công chứng|bản công chứng/i.test(detail)) copyType = /bản chính|bản gốc/i.test(detail) ? 'ORIGINAL_AND_COPY' : 'CERTIFIED_COPY';
  if (/tải tại|theo mẫu|mẫu tải/i.test(detail)) copyType = 'FORM';
  if (/ảnh 3x4/i.test(detail)) copyType = 'PHOTO';
  const qty = /02 (bản|ảnh)/.test(detail) ? 2 : 1;
  return { isMandatory: !optional, copyType, quantity: qty };
}

function importChecklist(ws) {
  const data = rows(ws).slice(1);
  const items = [];
  data.forEach((r, idx) => {
    const found = DOC_CODES.find(([, re]) => re.test(r[0]));
    if (!found) return;
    for (const [audience, col, src] of AUDIENCES) {
      const cls = classifyDoc(r[col], r[0]);
      if (!cls) continue;
      items.push({
        kind: 'DOC_CHECKLIST', itemKey: `DOC:${audience}:${found[0]}`, code: found[0], audience,
        title: r[0], detail: r[col], orderNo: idx + 1, sourceCodes: [src], ...cls,
      });
    }
  });
  return items;
}

// "01/01 – 31/12/2026": ngày thiếu năm lấy năm của ngày đầy đủ gần nhất phía sau.
const VI_DATE = /(?<!\d)(\d{2})\/(\d{2})(?:\/(\d{4}))?(?!\d)/g;
function parseDates(text) {
  const raw = [...text.matchAll(VI_DATE)].map((m) => ({ d: m[1], m: m[2], y: m[3] || null }));
  let year = null;
  for (let i = raw.length - 1; i >= 0; i -= 1) { if (raw[i].y) year = raw[i].y; else raw[i].y = year; }
  return raw.filter((x) => x.y && Number(x.m) >= 1 && Number(x.m) <= 12).map((x) => `${x.y}-${x.m}-${x.d}`);
}
function importSchedule(ws) {
  return rows(ws).slice(1).filter((r) => r[0]).map((r, idx) => {
    const dates = parseDates(r[2]);
    return {
      kind: 'SCHEDULE', itemKey: `SCHEDULE:${idx + 1}`, audience: r[0], title: r[1], detail: r[2],
      dateFrom: dates[0] || null, dateTo: dates[dates.length - 1] || null, orderNo: idx + 1,
      sourceCodes: r[3].match(/S\d{2}/g) || [], note: r[4] || null,
    };
  });
}

function importContacts(ws) {
  return rows(ws).slice(1).filter((r) => r[0]).map((r, idx) => ({
    kind: 'CONTACT', itemKey: `CONTACT:${idx + 1}`, audience: r[0], title: r[1], detail: r[2],
    orderNo: idx + 1, sourceCodes: r[3].match(/S\d{2}/g) || [], internalNote: r[4] || null,
  }));
}

function importSources(ws) {
  return rows(ws).slice(1).filter((r) => /^S\d{2}$/.test(r[0])).map((r) => ({
    code: r[0], title: r[1], url: r[2], dated: r[3], readingMethod: r[4], note: r[5] || null,
    // S21, S22 là nguồn ngoài chỉ dùng để cảnh báo -> không đưa vào kho tri thức trả lời.
    usable: !['S21', 'S22'].includes(r[0]),
    outdated: /ĐÃ CŨ/.test(r[5] || ''),
  }));
}

function importIssues(ws) {
  return rows(ws).slice(1).filter((r) => /^V\d{2}$/.test(r[0])).map((r) => ({
    code: r[0], topic: r[1], description: r[2], sources: r[3], impact: r[4], proposal: r[5],
  }));
}

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('Cách dùng: node scripts/import-excel.js <file.xlsx>');
    process.exit(1);
  }
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const sheet = (name) => {
    const ws = wb.getWorksheet(name);
    if (!ws) throw new Error(`Thiếu sheet "${name}"`);
    return ws;
  };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const write = (name, data) => {
    fs.writeFileSync(path.join(OUT_DIR, name), `${JSON.stringify(data, null, 2)}\n`);
    console.log(`  ${name}: ${data.length} bản ghi`);
  };
  write('faq.json', importFaq(sheet('Hỏi đáp chatbot')));
  write('majors.json', importMajors(sheet('Ngành nghề')));
  write('admission-items.json', [
    ...importChecklist(sheet('Hồ sơ')),
    ...importSchedule(sheet('Lịch tuyển sinh')),
    ...importContacts(sheet('Liên hệ')),
  ]);
  write('sources.json', importSources(sheet('Nguồn')));
  write('verification-issues.json', importIssues(sheet('Cần xác minh')));
}

main().catch((err) => { console.error(err); process.exit(1); });
