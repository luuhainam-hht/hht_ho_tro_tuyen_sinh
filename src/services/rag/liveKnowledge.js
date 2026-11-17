'use strict';
/**
 * Tri thức "sống" cho trợ lý: dựng các đoạn văn bản từ dữ liệu ĐANG HIỆU LỰC trong CSDL – ngành học
 * (hệ, học phí, hỗ trợ Nhà nước/Doanh nghiệp, phần sinh viên đóng), đợt nhận hồ sơ (kèm trạng thái theo
 * ngày hôm nay), hồ sơ theo đối tượng, liên hệ, hướng dẫn đăng ký, giải thích hệ đào tạo.
 *
 * Vì sao: các đoạn seed trong kb_chunks là ảnh chụp lúc nhập Excel; khi Phòng Tuyển sinh/Khoa sửa ngành
 * hay thêm đợt nhận hồ sơ, trợ lý phải trả lời theo dữ liệu mới ngay, không cần tải lại văn bản.
 * Đoạn có id ÂM (không trùng kb_chunks), không có embedding -> chấm theo độ phủ từ khóa; dựng lại khi
 * kb_version (gồm majors/admission_items.updated_at) hoặc ngày đổi.
 */
const { normalizeVi, coverage } = require('../../utils/textNormalize');
const { vnToday } = require('../../utils/time');
const { LEVELS, AUDIENCES, COPY_TYPES } = require('../../constants/catalog');
const majorProgramRepository = require('../../repositories/majorProgramRepository');

const LIVE_TITLE = 'Dữ liệu tuyển sinh cập nhật trên hệ thống';
const HEAD_BONUS = 1;
const LEVEL_ORDER = ['SO_CAP', 'HE_9_PLUS', 'TRUNG_CAP', 'CAO_DANG'];
const LEVEL_SHORT = { SO_CAP: 'Sơ cấp (SC)', HE_9_PLUS: 'Hệ 9+', TRUNG_CAP: 'Trung cấp (TC)', CAO_DANG: 'Cao đẳng (CĐ)' };

const fmtDate = (d) => (d ? String(d instanceof Date ? d.toISOString() : d).slice(0, 10).split('-').reverse().join('/') : '');
const money = (n) => `${Number(n).toLocaleString('vi-VN')} đồng`;
const pct = (s) => { const m = /(\d{1,3})\s*%/.exec(s || ''); return m ? Number(m[1]) : null; };

function scheduleStatus(item, today) {
  const from = item.date_from ? fmtIso(item.date_from) : null;
  const to = item.date_to ? fmtIso(item.date_to) : from;
  if (!from && !to) return '';
  if (to && to < today) return 'đã kết thúc';
  if (from && from > today) return 'sắp diễn ra';
  return 'đang diễn ra';
}
function fmtIso(d) { return String(d instanceof Date ? d.toISOString() : d).slice(0, 10); }

/** Câu mô tả học phí + hỗ trợ + phần sinh viên đóng của một ngành (dùng cho đoạn ngành và đoạn học phí). */
function tuitionSentence(m) {
  const parts = [];
  const state = m.state_support ? pct(m.state_support) : 0;
  const ent = m.enterprise_support ? pct(m.enterprise_support) : 0;
  if (m.tuition_per_month_min) {
    const max = m.tuition_per_month_max && m.tuition_per_month_max !== m.tuition_per_month_min ? ` đến ${money(m.tuition_per_month_max)}` : '';
    parts.push(`học phí Trung cấp/Cao đẳng từ ${money(m.tuition_per_month_min)}${max}/tháng`);
  }
  parts.push(m.state_support ? `Nhà nước hỗ trợ ${m.state_support}` : 'không ghi mức Nhà nước hỗ trợ riêng');
  if (m.enterprise_support) parts.push(`doanh nghiệp hỗ trợ ${m.enterprise_support}`);
  if (state !== null && ent !== null) {
    const sv = Math.max(0, 100 - state - ent);
    let svText = `sinh viên tự đóng khoảng ${sv}% học phí`;
    if (m.tuition_per_month_min) {
      const lo = Math.round((m.tuition_per_month_min * sv) / 100);
      const hi = Math.round(((m.tuition_per_month_max || m.tuition_per_month_min) * sv) / 100);
      svText += ` (khoảng ${money(lo)}${hi !== lo ? ` đến ${money(hi)}` : ''}/tháng)`;
    }
    parts.push(svText);
  }
  if (m.support_needs_verify && (m.state_support || m.enterprise_support)) parts.push('mức hỗ trợ cần Trung tâm Tuyển sinh xác nhận');
  return parts.join('; ');
}

/**
 * Độ phủ có trọng số IDF: từ có mặt ở rất nhiều đoạn ("cơ", "sở", "ngành", "học") nặng ít; từ hiếm hoặc
 * không có trong dữ liệu ("bể bơi") nặng nhiều. Tránh coi "Trường có bể bơi ở cơ sở 3?" là có căn cứ chỉ vì
 * đoạn Liên hệ chứa "cơ sở 3".
 */
function weightedCoverage(tokens, words, df, total) {
  if (!tokens.length) return 0;
  let all = 0;
  let hit = 0;
  for (const t of tokens) {
    const w = Math.log((total + 1) / ((df.get(t) || 0) + 1)) + 1;
    all += w;
    if (words.has(t)) hit += w;
  }
  return all ? hit / all : 0;
}

/** Bảng theo hệ -> câu cho trợ lý: "Hệ 9+: chỉ tiêu Cơ sở 1: 35, Cơ sở 2: 20; thời gian học …; học phí …; xét tuyển …". */
function programLines(programs) {
  const money = (n) => `${Number(n).toLocaleString('vi-VN')} đ`;
  return programs.map((p) => {
    const quota = [p.quota_cs1, p.quota_cs2, p.quota_cs3].map((q, i) => (q ? `Cơ sở ${i + 1}: ${q}` : null)).filter(Boolean);
    const tuition = p.tuition_min || p.tuition_max
      ? `${money(p.tuition_min ?? p.tuition_max)}${p.tuition_max && p.tuition_max !== p.tuition_min ? ` – ${money(p.tuition_max)}` : ''}/tháng`
      : null;
    const parts = [
      quota.length ? `chỉ tiêu ${quota.join(', ')}` : null,
      p.duration ? `thời gian học ${p.duration}` : null,
      tuition || p.tuition_note ? `học phí ${[tuition, p.tuition_note].filter(Boolean).join(' – ')}` : null,
      p.methods ? `xét tuyển: ${p.methods}` : null,
      p.note ? `ghi chú: ${p.note}` : null,
    ].filter(Boolean);
    const name = majorProgramRepository.LEVEL_SHORT[p.level];
    return parts.length ? `${name.startsWith('Hệ') ? name : `Hệ ${name}`}: ${parts.join('; ')}.` : null;
  });
}

function createLiveKnowledge({ db, configService, logger = console }) {
  let cache = { key: null, chunks: [], df: new Map() };

  async function build() {
    const year = configService.get('CURRENT_ADMISSION_YEAR');
    const today = vnToday();
    const [{ rows: majors }, { rows: items }, programsByMajor] = await Promise.all([
      db.query(`SELECT code, name, faculty, levels, duration, tuition_per_month_min, tuition_per_month_max, state_support, enterprise_support,
                       support_needs_verify, quota_9plus_cs1, quota_9plus_cs2, description
                  FROM majors WHERE is_active AND admission_year = ? ORDER BY faculty, name`, [year]),
      db.query(`SELECT kind, audience, code, title, detail, is_mandatory, copy_type, quantity, date_from, date_to, order_no
                  FROM admission_items WHERE is_active AND admission_year = ? ORDER BY kind, audience, order_no, id`, [year]),
      majorProgramRepository.mapByMajors(db),
    ]);
    const yearLabel = `${year}–${year + 1}`;
    const out = [];
    const add = (heading, content, url) => out.push({ heading, content, url });

    // 1) Từng ngành
    for (const m of majors) {
      const levels = LEVEL_ORDER.filter((l) => m.levels.includes(l)).map((l) => LEVEL_SHORT[l]);
      const lines = [
        `Ngành ${m.name} (mã ${m.code}) thuộc Khoa ${m.faculty}, tuyển sinh năm học ${yearLabel}.`,
        levels.length ? `Hệ tuyển sinh: ${levels.join(', ')}.` : 'Năm nay chưa công bố hệ tuyển sinh cho ngành này.',
        `Học phí và hỗ trợ: ${tuitionSentence(m)}.`,
        // Bảng theo hệ (chỉ tiêu CS1/2/3, thời gian, học phí, phương thức) thay cho dòng tóm tắt cũ.
        ...(programsByMajor.get(m.code)?.length ? programLines(programsByMajor.get(m.code)) : [
          m.duration ? `Thời gian học: ${m.duration}.` : null,
          m.quota_9plus_cs1 || m.quota_9plus_cs2 ? `Chỉ tiêu hệ 9+: ${[m.quota_9plus_cs1 ? `Cơ sở 1: ${m.quota_9plus_cs1}` : null, m.quota_9plus_cs2 ? `Cơ sở 2: ${m.quota_9plus_cs2}` : null].filter(Boolean).join('; ')}.` : null,
        ]),
        m.description ? `Giới thiệu: ${m.description}` : null,
      ].filter(Boolean);
      add(`Ngành học › ${m.name}`, lines.join('\n'), `/nganh-chi-tiet.html?code=${encodeURIComponent(m.code)}`);
    }

    // 2) Ngành theo khoa (+ trang giới thiệu khoa trên website trường, cấu hình FACULTY_PAGES)
    let pages = {};
    try { pages = configService.getOr('FACULTY_PAGES', {}) || {}; } catch { pages = {}; }
    const fkey = (x) => String(x || '').toLowerCase().replace(/^khoa\s+/, '').replace(/[–—-]/g, '-').replace(/\s+/g, ' ').trim();
    const facultyPage = (f) => Object.entries(pages).find(([k]) => fkey(k) === fkey(f))?.[1] || null;
    const faculties = [...new Set(majors.map((m) => m.faculty))];
    for (const f of faculties) {
      const list = majors.filter((m) => m.faculty === f && m.levels.length)
        .map((m) => `- ${m.name}: ${LEVEL_ORDER.filter((l) => m.levels.includes(l)).map((l) => LEVEL_SHORT[l]).join(', ')}`);
      const page = facultyPage(f);
      if (list.length) add(`Ngành học › Khoa ${f}`, `Khoa ${f} tuyển sinh năm học ${yearLabel} các ngành:\n${list.join('\n')}${page ? `\nTrang giới thiệu Khoa ${f}: ${page}` : ''}`, `/nganh.html?faculty=${encodeURIComponent(f)}`);
    }

    // 3) Ngành theo hệ + giải thích hệ
    const levelInfo = Object.fromEntries(items.filter((i) => i.kind === 'LEVEL_INFO').map((i) => [i.code, i]));
    for (const l of LEVEL_ORDER) {
      const names = majors.filter((m) => m.levels.includes(l)).map((m) => m.name);
      const info = levelInfo[l];
      // Giải thích hệ và danh sách ngành tách hai đoạn: đoạn danh sách dài không lấn át câu hỏi về một ngành cụ thể.
      if (info) add(`Hệ đào tạo › ${LEVEL_SHORT[l]} là gì`, `${info.title}: ${info.detail}`, `/nganh.html?level=${l}`);
      if (names.length) add(`Hệ đào tạo › Danh sách ngành tuyển ${LEVEL_SHORT[l]}`, `Các ngành tuyển ${LEVEL_SHORT[l]} (${LEVELS[l]}) năm học ${yearLabel} (${names.length} ngành): ${names.join(', ')}.`, `/nganh.html?level=${l}`);
    }

    // 4) Học phí & hỗ trợ học phí
    const supportInfo = items.filter((i) => i.kind === 'SUPPORT_INFO');
    if (supportInfo.length) add('Học phí › Các loại hỗ trợ học phí', supportInfo.map((i) => `${i.title}: ${i.detail}`).join('\n'), '/nganh.html');
    const stateList = majors.filter((m) => m.state_support).map((m) => `- ${m.name}: Nhà nước hỗ trợ ${m.state_support}`);
    if (stateList.length) add('Học phí › Ngành được Nhà nước hỗ trợ học phí', `Các ngành có mức Nhà nước hỗ trợ học phí trong bảng ngành:\n${stateList.join('\n')}`, '/nganh.html?support=STATE');
    const entList = majors.filter((m) => m.enterprise_support).map((m) => `- ${m.name}: doanh nghiệp hỗ trợ ${m.enterprise_support}`);
    if (entList.length) add('Học phí › Ngành được doanh nghiệp hỗ trợ học phí', `Các ngành có doanh nghiệp hỗ trợ học phí:\n${entList.join('\n')}`, '/nganh.html?support=ENTERPRISE');

    // 5) Lịch / đợt nhận hồ sơ (trạng thái tính theo HÔM NAY)
    const sched = items.filter((i) => i.kind === 'SCHEDULE');
    for (const group of [...new Set(sched.map((s) => s.audience))]) {
      const lines = sched.filter((s) => s.audience === group).map((s) => {
        const st = scheduleStatus(s, today);
        return `- ${s.title}: ${s.detail}${st ? ` (${st})` : ''}`;
      });
      add(`Lịch tuyển sinh › ${group}`, `Đợt nhận hồ sơ, nhập học – ${group}. Hôm nay là ${fmtDate(today)}.\n${lines.join('\n')}`, '/lich-tuyen-sinh.html');
    }
    const ongoing = sched.filter((s) => scheduleStatus(s, today) === 'đang diễn ra');
    if (ongoing.length) add('Lịch tuyển sinh › Đang nhận hồ sơ', `Tính đến hôm nay (${fmtDate(today)}), các đợt đang diễn ra:\n${ongoing.map((s) => `- ${s.audience} – ${s.title}: ${s.detail}`).join('\n')}`, '/lich-tuyen-sinh.html');

    // 6) Hồ sơ theo đối tượng
    for (const [aud, label] of Object.entries(AUDIENCES)) {
      const docs = items.filter((i) => i.kind === 'DOC_CHECKLIST' && i.audience === aud);
      if (!docs.length) continue;
      const lines = docs.map((i) => `- ${i.title}${i.is_mandatory === false ? ' (nếu thuộc diện)' : ''}${i.detail ? `: ${i.detail}` : ''}${i.copy_type ? ` [${COPY_TYPES[i.copy_type]}${i.quantity ? ` × ${i.quantity}` : ''}]` : ''}`);
      add(`Hồ sơ › ${label}`, `Hồ sơ xét tuyển cho đối tượng ${label} gồm:\n${lines.join('\n')}`, `/ho-so.html?audience=${aud}`);
    }

    // 7) Hướng dẫn đăng ký
    const guide = items.filter((i) => i.kind === 'ONLINE_GUIDE_STEP');
    if (guide.length) add('Hướng dẫn đăng ký xét tuyển', `Các bước đăng ký xét tuyển:\n${guide.map((g, i) => `${i + 1}. ${g.title}: ${g.detail}`).join('\n')}`, '/huong-dan-dang-ky.html');

    // 8) Liên hệ
    const cfg = (k) => configService.getOr(k, '');
    const contacts = items.filter((i) => i.kind === 'CONTACT' && !/CẦN BỔ SUNG|không công bố/i.test(i.detail));
    const contactLines = [
      cfg('HOTLINE') ? `- Hotline tuyển sinh: ${cfg('HOTLINE')}` : null,
      cfg('ADMISSION_EMAIL') ? `- Email tuyển sinh: ${cfg('ADMISSION_EMAIL')}` : null,
      cfg('SUBMISSION_ADDRESS') ? `- Địa chỉ nộp hồ sơ: ${cfg('SUBMISSION_ADDRESS')}` : null,
      cfg('OFFICIAL_REGISTER_URL') ? `- Đăng ký xét tuyển trực tuyến: ${cfg('OFFICIAL_REGISTER_URL')}` : null,
      ...contacts.map((i) => `- ${i.audience} – ${i.title}: ${i.detail}`),
    ].filter(Boolean);
    if (contactLines.length) add('Liên hệ tuyển sinh', `Thông tin liên hệ tuyển sinh của ${cfg('SCHOOL_NAME') || 'Nhà trường'}:\n${contactLines.join('\n')}`, '/lien-he.html');

    return out.map((c, i) => {
      const content = c.content;
      const contentNorm = normalizeVi(content);
      const headNorm = normalizeVi(`${LIVE_TITLE} ${c.heading}`);
      return {
        id: -(i + 1), live: true, document_id: null, heading_path: c.heading, content,
        content_norm: contentNorm, head_norm: headNorm, words: new Set(`${contentNorm} ${headNorm}`.split(' ')),
        head_words: new Set(normalizeVi(c.heading).split(' ')),
        page_from: null, page_to: null, title: LIVE_TITLE, source_url: c.url, source_code: null, doc_no: null, reliability: 'A',
      };
    });
  }

  function documentFrequency(chunks) {
    const df = new Map();
    for (const c of chunks) for (const w of c.words) df.set(w, (df.get(w) || 0) + 1);
    return df;
  }

  async function all(kbVersion) {
    // Tham số liên hệ không nằm trong kb_version -> đưa vào khóa để sửa hotline/email là có hiệu lực ngay.
    const contactKey = ['HOTLINE', 'ADMISSION_EMAIL', 'SUBMISSION_ADDRESS', 'OFFICIAL_REGISTER_URL', 'SCHOOL_NAME', 'CURRENT_ADMISSION_YEAR', 'FACULTY_PAGES'].map((k) => JSON.stringify(configService.getOr(k, ''))).join('|');
    const key = `${kbVersion}|${vnToday()}|${contactKey}`;
    if (cache.key !== key) {
      try {
        const chunks = await build();
        cache = { key, chunks, df: documentFrequency(chunks) };
      } catch (err) {
        logger.warn('[live] không dựng được tri thức từ dữ liệu tuyển sinh:', err.message);
        return cache.chunks; // giữ bản cũ còn hơn không có
      }
    }
    return cache.chunks;
  }

  /**
   * Xếp hạng theo độ phủ từ khóa có trọng số IDF; tiêu đề đoạn được tính (câu "học phí ngành ô tô" khớp
   * đoạn "Ngành học › Công nghệ ô tô"). Trả kèm `coverage` (có trọng số) để retriever xét "có căn cứ".
   */
  async function search({ tokens, kbVersion, limit = 20 }) {
    if (!tokens.length) return [];
    const list = await all(kbVersion);
    const { df } = cache;
    return list
      .map((c) => ({ c, score: weightedCoverage(tokens, c.words, df, list.length), head: weightedCoverage(tokens, c.head_words, df, list.length) }))
      .filter((x) => x.score > 0)
      // Từ khóa nằm ngay trong tiêu đề đoạn ("Ngành học › Công nghệ ô tô") được cộng điểm: đoạn danh sách dài
      // (liệt kê hàng chục ngành) không lấn át đoạn đúng chủ đề. Hòa điểm thì đoạn ngắn (cụ thể hơn) trước.
      .sort((a, b) => (b.score + HEAD_BONUS * b.head) - (a.score + HEAD_BONUS * a.head) || a.c.content.length - b.c.content.length)
      .slice(0, limit)
      .map((x) => ({ ...x.c, weightedCoverage: x.score }));
  }

  /** Đoạn theo id (để retriever ghép kết quả). */
  async function byIds(ids, kbVersion) {
    const set = new Set(ids);
    return (await all(kbVersion)).filter((c) => set.has(c.id));
  }

  return { search, byIds, all, invalidate: () => { cache = { key: null, chunks: [] }; } };
}

module.exports = { createLiveKnowledge, tuitionSentence, weightedCoverage, LIVE_TITLE };
