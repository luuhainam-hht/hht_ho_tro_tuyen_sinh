'use strict';
/**
 * Nạp dữ liệu thật từ db/seed/*.json (sinh bởi scripts/import-excel.js từ bộ dữ liệu nhóm đề tài
 * thu thập ngày 14/11/2026). Idempotent: ON CONFLICT DO NOTHING theo khóa tự nhiên -> chạy mỗi lần
 * khởi động không ghi đè chỉnh sửa của cán bộ trong Admin.
 *
 * Nguyên tắc an toàn thông tin (theo sheet "Báo cáo"):
 *  - FAQ độ tin cậy C (nguồn mâu thuẫn) nạp DRAFT, chờ Lãnh đạo duyệt; A/B/D nạp APPROVED.
 *  - Mức hỗ trợ học phí từng ngành (2 bảng ngành mâu thuẫn) chỉ hiển thị kèm nhãn "cần xác minh",
 *    KHÔNG đưa vào kho tri thức để trợ lý không khẳng định.
 *  - Nguồn ngoài (S21, S22) và nguồn cũ (ĐÃ CŨ) không công bố vào kho trả lời.
 */
const fs = require('node:fs');
const path = require('node:path');
const { normalizeVi } = require('../utils/textNormalize');
const { chunkLines, estimateTokens } = require('../services/rag/chunker');
const { LEVELS, AUDIENCES, COPY_TYPES } = require('../constants/catalog');

const SEED_DIR = path.join(__dirname, '..', '..', 'db', 'seed');
const SEED_YEAR = 2026; // năm học 2026–2027
const load = (name) => JSON.parse(fs.readFileSync(path.join(SEED_DIR, name), 'utf8'));

/**
 * Chạy INSERT … ON CONFLICT DO NOTHING; ở chế độ refresh (cập nhật dữ liệu từ Excel mới) đổi thành
 * DO UPDATE các cột do bộ dữ liệu quản lý – chỉnh sửa của cán bộ ở các cột đó sẽ bị ghi đè (đã sao lưu trước).
 */
function upsert(c, sql, params, { refresh, conflict, update, extra }) {
  if (!refresh) return c.query(sql, params);
  const sets = update.map((col) => `${col} = EXCLUDED.${col}`);
  if (extra) sets.push(extra);
  const re = new RegExp(`ON CONFLICT \\(${conflict}\\) DO NOTHING`);
  if (!re.test(sql)) throw new Error(`Không tìm thấy ON CONFLICT (${conflict}) trong câu lệnh seed`);
  return c.query(sql.replace(re, `ON CONFLICT (${conflict}) DO UPDATE SET ${sets.join(', ')}`), params);
}

function parseVnDate(s) {
  const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(s || '');
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

async function seedSources(c, sources, refresh = false) {
  for (const s of sources) {
    const status = s.usable && !s.outdated ? 'PUBLISHED' : 'ARCHIVED';
    await upsert(c, 
      `INSERT INTO kb_documents (title, source_code, issued_date, admission_year, source_url, status, published_at)
       VALUES (?, ?, ?, ?, ?, ?, now()) ON CONFLICT (source_code) DO NOTHING`,
      [s.title, s.code, parseVnDate(s.dated), SEED_YEAR, s.url, status],
      { refresh, conflict: 'source_code', update: ['title', 'issued_date', 'source_url', 'status'] },
    );
  }
  const { rows } = await c.query('SELECT id, source_code, status FROM kb_documents WHERE source_code IS NOT NULL');
  return new Map(rows.map((r) => [r.source_code, r]));
}

async function seedFaq(c, faqs, docs, refresh = false) {
  for (const f of faqs) {
    const doc = f.sourceCodes.map((code) => docs.get(code)).find(Boolean);
    await upsert(c, 
      `INSERT INTO faq_entries (code, topic, question, answer, variants, match_text_norm, applies_to, source_codes, reliability,
                                internal_note, document_id, admission_year, status, approved_at)
       VALUES (?, ?, ?, ?, ?::jsonb, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (code) DO NOTHING`,
      [f.code, f.topic, f.question, f.answer, JSON.stringify(f.variants), normalizeVi([f.question, ...f.variants].join(' | ')),
        f.appliesTo, f.sourceCodes, f.reliability, f.internalNote, doc?.id ?? null, SEED_YEAR, f.status, f.status === 'APPROVED' ? new Date() : null],
      { refresh, conflict: 'code', update: ['topic', 'question', 'answer', 'variants', 'match_text_norm', 'applies_to', 'source_codes', 'reliability', 'internal_note', 'document_id', 'status', 'approved_at'], extra: 'embedding = NULL' },
    );
  }
}

function profileFor(major, profiles) {
  const base = profiles.faculties[major.faculty] || { riasec: {}, subjects: {}, workStyles: [], description: '', careers: [] };
  const o = profiles.overrides.find((x) => major.name.toLowerCase().includes(x.match.toLowerCase())) || {};
  return {
    riasec: o.riasec || base.riasec, subjects: o.subjects || base.subjects, workStyles: o.workStyles || base.workStyles,
    description: base.description, careers: base.careers,
  };
}

async function seedMajors(c, majors, profiles, docs, refresh = false) {
  for (const m of majors) {
    const p = profileFor(m, profiles);
    // Hỗ trợ học phí: ưu tiên bảng 08/2026 (mới nhất) nếu ngành còn trong bảng; luôn gắn cờ cần xác minh.
    const state = m.listedIn082026 ? (m.stateSupport082026 || m.stateSupport032026) : m.stateSupport032026;
    const enterprise = m.listedIn082026 ? (m.enterpriseSupport082026 || null) : m.enterpriseSupport032026;
    const durationParts = [];
    if (m.levels.includes('CAO_DANG')) durationParts.push('Cao đẳng khoảng 3 năm');
    if (m.levels.includes('TRUNG_CAP')) durationParts.push('Trung cấp khoảng 2 năm');
    if (m.levels.includes('HE_9_PLUS')) durationParts.push('Hệ 9+ 4 năm (3 + 1)');
    await upsert(c, 
      `INSERT INTO majors (code, occupation_code, name, faculty, levels, levels_latest, listed_in_latest_table, description,
                           quota_9plus_cs1, quota_9plus_cs2, tuition_per_month_min, tuition_per_month_max, state_support, enterprise_support,
                           support_needs_verify, duration, admission_methods, career_paths, skills, work_styles, riasec_profile, subject_weights,
                           profile_is_sample, source_codes, internal_note, admission_year, document_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE, ?, ?::jsonb, ?::jsonb, '[]'::jsonb, ?, ?::jsonb, ?::jsonb, TRUE, ?, ?, ?, ?)
       ON CONFLICT (code) DO NOTHING`,
      [m.code, m.occupationCode, m.name, m.faculty, m.levels, m.levels082026, m.listedIn082026, p.description,
        m.quota9PlusCs1, m.quota9PlusCs2,
        m.levels.some((l) => l === 'CAO_DANG' || l === 'TRUNG_CAP') ? 1800000 : null,
        m.levels.some((l) => l === 'CAO_DANG' || l === 'TRUNG_CAP') ? 2400000 : null,
        state, enterprise, durationParts.join('; ') || null,
        JSON.stringify(['Xét học bạ', 'Xét điểm thi tốt nghiệp THPT (hệ Cao đẳng)']), JSON.stringify(p.careers), p.workStyles,
        JSON.stringify(p.riasec), JSON.stringify(p.subjects), m.sourceCodes, m.internalNote, SEED_YEAR, docs.get('S01')?.id ?? null],
      { refresh, conflict: 'code', update: ['occupation_code', 'name', 'faculty', 'levels', 'levels_latest', 'listed_in_latest_table', 'quota_9plus_cs1', 'quota_9plus_cs2', 'state_support', 'enterprise_support', 'duration', 'source_codes', 'internal_note'] },
    );
  }
}

/** Các bước đăng ký trực tuyến (Q28, Q29 – độ tin cậy A, nguồn S01/S10). */
const GUIDE_STEPS = [
  ['Xác định đối tượng', 'Tốt nghiệp THCS: hệ 9+ hoặc Trung cấp. Tốt nghiệp THPT: hệ Cao đẳng (hoặc Trung cấp).', ['S01']],
  ['Chọn phương thức xét tuyển', 'Xét học bạ THCS/THPT hoặc kết quả tốt nghiệp. Hệ Cao đẳng xét học bạ hoặc điểm thi tốt nghiệp THPT, xét tất cả tổ hợp.', ['S01']],
  ['Đăng ký trực tuyến', 'Điền biểu mẫu tại website trường: thông tin cá nhân (họ tên, ngày sinh, giới tính, điện thoại, trường đã học), tối đa 3 nguyện vọng (ngành + cấp bậc), địa chỉ nhận thư, xác nhận thông tin.', ['S10']],
  ['Nộp hồ sơ', 'Nộp trực tiếp tại trường, gửi bưu điện, hoặc đặt lịch hẹn nộp hồ sơ trên hệ thống này. Trường nhận hồ sơ từ 01/01 đến 31/12 hằng năm.', ['S01']],
  ['Hoàn tất nhập học', 'Hoàn tất thủ tục nhập học trực tiếp tại trường theo đợt nhập học.', ['S01']],
];

/**
 * Giải thích hệ đào tạo và loại hỗ trợ học phí: hiện khi bấm vào cột SC / Hệ 9+ / TC / CĐ và
 * Nhà nước / Doanh nghiệp / Sinh viên trên trang Ngành học, đồng thời là tri thức của trợ lý.
 * Nội dung tổng hợp từ FAQ độ tin cậy A/B (Q10, Q11, Q13, Q17, Q18, Q20, Q21, Q31, Q32, Q35, Q39).
 * Phòng Tuyển sinh sửa được trong Quản trị > Thông tin tuyển sinh.
 */
const LEVEL_INFO = [
  ['SO_CAP', 'Sơ cấp (SC) – đào tạo ngắn hạn',
    'Hệ Sơ cấp là các lớp đào tạo ngắn hạn, học xong được cấp chứng chỉ, chứng nhận nghề. Trường tuyển sinh và mở lớp liên tục trong năm cho nhiều nghề thuộc các lĩnh vực Cơ khí, Điện – Điện tử, Công nghệ thông tin, Ngoại ngữ, Chăm sóc sắc đẹp, Công nghệ ô tô, Kinh tế – Du lịch, Nông nghiệp. Phù hợp với người cần học nhanh một nghề để đi làm hoặc bổ sung kỹ năng. Thời gian và học phí từng lớp: liên hệ Trung tâm Tuyển sinh.', ['S01']],
  ['HE_9_PLUS', 'Hệ 9+ (THPT – Cao đẳng)',
    'Hệ 9+ dành cho học sinh tốt nghiệp THCS, xét tuyển học bạ/kết quả học tập lớp 9. Thời gian đào tạo 4 năm:\n- 3 năm đầu: học song song chương trình văn hóa THPT (GDTX) và Trung cấp, dự thi tốt nghiệp THPT, nhận 2 bằng: tốt nghiệp THPT và Trung cấp.\n- 1 năm cuối: học chương trình Cao đẳng, nhận bằng Cao đẳng (Kỹ sư/Cử nhân thực hành), đủ điều kiện học liên thông lên đại học.\nHọc phí: phần Trung cấp được miễn 100%; phần Cao đẳng 1.800.000 – 2.400.000 đ/tháng tùy nghề; học phí văn hóa theo quy định của Nhà nước và TP Hà Nội.', ['S02', 'S01']],
  ['TRUNG_CAP', 'Trung cấp (TC)',
    'Hệ Trung cấp tuyển người tốt nghiệp THCS hoặc tương đương trở lên, thời gian học khoảng 2 năm. Tốt nghiệp được cấp bằng Trung cấp chính quy và được học liên thông lên Cao đẳng, Đại học. Học phí từ 1.800.000 đến 2.400.000 đ/tháng tùy ngành; nhiều ngành được Nhà nước hoặc doanh nghiệp hỗ trợ một phần.', ['S01']],
  ['CAO_DANG', 'Cao đẳng (CĐ)',
    'Hệ Cao đẳng chính quy dành cho người đã tốt nghiệp THPT hoặc tương đương trở lên, tuyển sinh trên toàn quốc, thời gian học khoảng 3 năm; xét học bạ hoặc điểm thi tốt nghiệp THPT. Tốt nghiệp được cấp bằng Cao đẳng chính quy (danh hiệu Kỹ sư/Cử nhân thực hành) và được học liên thông lên Đại học. Người đã tốt nghiệp Trung cấp, Cao đẳng, Đại học có thể học Cao đẳng liên thông. Học phí từ 1.800.000 đến 2.400.000 đ/tháng tùy ngành.', ['S01', 'S07']],
];
const SUPPORT_INFO = [
  ['NHA_NUOC', 'Nhà nước hỗ trợ học phí',
    'Sinh viên hệ Cao đẳng chính quy học các nghề thuộc danh mục nặng nhọc, độc hại, nguy hiểm được Nhà nước hỗ trợ 70% học phí. Người học thường trú tại Hà Nội học Trung cấp/Cao đẳng thuộc ngành, nghề trọng điểm được thành phố hỗ trợ học phí theo Nghị quyết 57/2026/NQ-HĐND (có thể đến 100%). Ngoài ra có chế độ miễn, giảm học phí theo Nghị định 238/2025/NĐ-CP tùy đối tượng.', ['S07', 'S01', 'S04']],
  ['DOANH_NGHIEP', 'Doanh nghiệp hỗ trợ học phí',
    'Một số ngành có doanh nghiệp đối tác hỗ trợ một phần học phí (thường 30%; riêng một vài ngành cao hơn). Mức hỗ trợ từng ngành được ghi trong bảng ngành và cần Trung tâm Tuyển sinh xác nhận trước khi nhập học.', ['S01']],
  ['SINH_VIEN', 'Phần sinh viên tự đóng',
    'Số tiền sinh viên tự đóng = học phí tháng – phần Nhà nước hỗ trợ – phần Doanh nghiệp hỗ trợ. Học phí hệ Trung cấp, Cao đẳng từ 1.800.000 đến 2.400.000 đ/tháng tùy ngành; hệ 9+ được miễn 100% học phí phần Trung cấp. Con số trên trang Ngành học là ước tính theo tháng, chưa tính miễn giảm theo đối tượng và học bổng.', ['S01']],
];

async function seedAdmissionItems(c, items, docs, refresh = false) {
  const all = [
    ...items,
    ...GUIDE_STEPS.map(([title, detail, src], i) => ({ kind: 'ONLINE_GUIDE_STEP', itemKey: `GUIDE:${i + 1}`, audience: 'ALL', title, detail, orderNo: i + 1, sourceCodes: src })),
    ...LEVEL_INFO.map(([code, title, detail, src], i) => ({ kind: 'LEVEL_INFO', itemKey: `LEVEL:${code}`, audience: 'ALL', code, title, detail, orderNo: i + 1, sourceCodes: src })),
    ...SUPPORT_INFO.map(([code, title, detail, src], i) => ({ kind: 'SUPPORT_INFO', itemKey: `SUPPORT:${code}`, audience: 'ALL', code, title, detail, orderNo: i + 1, sourceCodes: src })),
  ];
  for (const it of all) {
    await upsert(c, 
      `INSERT INTO admission_items (item_key, kind, audience, code, title, detail, is_mandatory, copy_type, quantity, note, internal_note,
                                    order_no, date_from, date_to, source_codes, document_id, admission_year)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (item_key) DO NOTHING`,
      [it.itemKey, it.kind, it.audience || 'ALL', it.code ?? null, it.title, it.detail || '', it.isMandatory ?? null, it.copyType ?? null,
        it.quantity ?? null, null, it.internalNote ?? null, it.orderNo ?? 0, it.dateFrom ?? null, it.dateTo ?? null,
        it.sourceCodes || [], docs.get((it.sourceCodes || [])[0])?.id ?? null, SEED_YEAR],
      { refresh, conflict: 'item_key', update: ['kind', 'audience', 'code', 'title', 'detail', 'is_mandatory', 'copy_type', 'quantity', 'order_no', 'date_from', 'date_to', 'source_codes', 'document_id'] },
    );
  }
}

/**
 * Kho tri thức khởi tạo: mỗi nguồn PUBLISHED nhận các đoạn từ FAQ (A/B/D) có nguồn chính là nó,
 * cộng các bảng có cấu trúc (ngành theo khoa, hồ sơ, lịch, liên hệ). Chỉ nạp khi tài liệu chưa có đoạn nào.
 */
function buildSeedChunks({ faqs, majors, items, docs }) {
  const byDoc = new Map();
  const add = (code, heading, text) => {
    const d = docs.get(code);
    if (!d || d.status !== 'PUBLISHED') return;
    if (!byDoc.has(d.id)) byDoc.set(d.id, []);
    byDoc.get(d.id).push({ heading, text });
  };
  for (const f of faqs.filter((x) => x.status === 'APPROVED')) {
    add(f.sourceCodes[0], f.topicLabel, `Hỏi: ${f.question}\nĐáp: ${f.answer}`);
  }
  const faculties = [...new Set(majors.map((m) => m.faculty))];
  for (const fac of faculties) {
    const lines = majors.filter((m) => m.faculty === fac && m.levels.length).map((m) => `- ${m.name}: tuyển hệ ${m.levels.map((l) => LEVELS[l]).join(', ')}`);
    add('S01', `Ngành nghề đào tạo › Khoa ${fac}`, `Khoa ${fac} tuyển sinh năm học 2026–2027 (theo bảng ngành trong thông báo tuyển sinh):\n${lines.join('\n')}`);
  }
  const q9 = majors.filter((m) => m.quota9PlusCs1 || m.quota9PlusCs2)
    .map((m) => `- ${m.name}: ${[m.quota9PlusCs1 ? `Cơ sở 1: ${m.quota9PlusCs1}` : null, m.quota9PlusCs2 ? `Cơ sở 2: ${m.quota9PlusCs2}` : null].filter(Boolean).join('; ')}`);
  add('S02', 'Hệ 9+ › Chỉ tiêu theo nghề và cơ sở', `Chỉ tiêu hệ 9+ năm học 2026–2027 theo nghề:\n${q9.join('\n')}`);
  for (const [aud, label] of Object.entries(AUDIENCES)) {
    const docsFor = items.filter((i) => i.kind === 'DOC_CHECKLIST' && i.audience === aud);
    if (!docsFor.length) continue;
    const lines = docsFor.map((i) => `- ${i.title}${i.isMandatory ? '' : ' (nếu thuộc diện)'}: ${i.detail}${i.copyType ? ` [${COPY_TYPES[i.copyType]}]` : ''}`);
    add(docsFor[0].sourceCodes[0], `Hồ sơ › ${label}`, `Danh mục hồ sơ cho đối tượng ${label}:\n${lines.join('\n')}`);
  }
  const sched = items.filter((i) => i.kind === 'SCHEDULE');
  for (const src of [...new Set(sched.map((s) => s.sourceCodes[0]))]) {
    const lines = sched.filter((s) => s.sourceCodes[0] === src).map((s) => `- ${s.audience} – ${s.title}: ${s.detail}`);
    add(src, 'Lịch tuyển sinh', `Các mốc thời gian tuyển sinh:\n${lines.join('\n')}`);
  }
  const contacts = items.filter((i) => i.kind === 'CONTACT' && !/CẦN BỔ SUNG|không công bố/i.test(i.detail));
  add('S20', 'Liên hệ', `Thông tin liên hệ tuyển sinh:\n${contacts.map((i) => `- ${i.audience} – ${i.title}: ${i.detail}`).join('\n')}`);
  return byDoc;
}

async function seedChunks(c, byDoc, refresh = false) {
  for (const [docId, entries] of byDoc) {
    if (refresh) await c.query('DELETE FROM kb_chunks WHERE document_id = ?', [docId]);
    const { rows } = await c.query('SELECT COUNT(*)::int AS n FROM kb_chunks WHERE document_id = ?', [docId]);
    if (rows[0].n > 0) continue;
    const lines = entries.flatMap((e) => [{ heading: 1, text: e.heading }, ...e.text.split('\n').map((t) => ({ text: t }))]);
    // Mỗi cặp hỏi–đáp là một đơn vị nghĩa: tách đoạn ở mỗi đề mục, ngưỡng nhỏ để không trộn chủ đề.
    const chunks = chunkLines(lines, { target: 350, max: 600, min: 1 });
    let idx = 0;
    for (const ch of chunks) {
      await c.query(
        `INSERT INTO kb_chunks (document_id, chunk_index, heading_path, content, content_norm, token_count)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [docId, idx, ch.headingPath, ch.content, ch.contentNorm, ch.tokenCount || estimateTokens(ch.content)],
      );
      idx += 1;
    }
    await c.query('UPDATE kb_documents SET chunk_count = ? WHERE id = ?', [idx, docId]);
  }
}

async function seedAll(c, { refresh = false } = {}) {
  const sources = load('sources.json');
  const faqs = load('faq.json');
  const majors = load('majors.json');
  const items = load('admission-items.json');
  const profiles = load('major-profiles.json');
  const docs = await seedSources(c, sources, refresh);
  await seedFaq(c, faqs, docs, refresh);
  await seedMajors(c, majors, profiles, docs, refresh);
  await seedAdmissionItems(c, items, docs, refresh);
  await seedChunks(c, buildSeedChunks({ faqs, majors, items, docs }), refresh);
}

module.exports = { seedAll, buildSeedChunks, SEED_YEAR, LEVEL_INFO, SUPPORT_INFO };
