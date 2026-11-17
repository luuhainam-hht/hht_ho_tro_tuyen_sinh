'use strict';
/**
 * M3 – Cẩm nang tuyển sinh số: đọc majors + admission_items + FAQ đã duyệt của năm hiện hành.
 * Trạng thái lịch (đã qua / đang diễn ra / sắp tới) tính theo ngày Việt Nam tại thời điểm hỏi,
 * không dùng cột "tình trạng" chụp lúc thu thập dữ liệu (sẽ sai sau vài tuần).
 */
const { HttpError } = require('../utils/httpError');
const { normalizeVi } = require('../utils/textNormalize');
const { vnToday } = require('../utils/time');
const { LEVELS, AUDIENCES, TOPICS, COPY_TYPES } = require('../constants/catalog');
const majorRepository = require('../repositories/majorRepository');
const admissionItemRepository = require('../repositories/admissionItemRepository');
const majorProgramRepository = require('../repositories/majorProgramRepository');

function scheduleStatus(item, today) {
  if (!item.date_from && !item.date_to) return 'UNKNOWN';
  const from = item.date_from ? String(item.date_from).slice(0, 10) : null;
  const to = item.date_to ? String(item.date_to).slice(0, 10) : from;
  if (to && to < today) return 'PAST';
  if (from && from > today) return 'UPCOMING';
  return 'ONGOING';
}

function createHandbookService({ db, configService }) {
  const year = () => configService.get('CURRENT_ADMISSION_YEAR');

  async function listMajors({ level = null, faculty = null, q = null, support = null } = {}) {
    let rows = await majorRepository.listActive(db, { year: year(), level, faculty });
    if (q) {
      const nq = normalizeVi(q);
      rows = rows.filter((m) => normalizeVi(`${m.name} ${m.faculty} ${m.occupation_code || ''}`).includes(nq));
    }
    if (support === 'STATE') rows = rows.filter((m) => m.state_support);
    if (support === 'ENTERPRISE') rows = rows.filter((m) => m.enterprise_support);
    return rows;
  }

  async function majorDetail(code) {
    const m = await majorRepository.findByCode(db, code);
    if (!m) throw new HttpError(404, 'Không tìm thấy ngành');
    const { rows: related } = await db.query(
      'SELECT code, name, levels FROM majors WHERE faculty = ? AND code <> ? AND is_active ORDER BY name LIMIT 8', [m.faculty, code],
    );
    delete m.riasec_profile;
    delete m.subject_weights;
    // Bảng thông tin tuyển sinh theo hệ + mục riêng của ngành (hồ sơ/đợt/liên hệ do Phòng Tuyển sinh, Khoa thêm).
    const [programs, items] = await Promise.all([
      majorProgramRepository.listByMajor(db, code),
      admissionItemRepository.listForMajor(db, year(), code),
    ]);
    return { ...m, related, programs, items };
  }

  async function checklist({ audience, majorCode = null }) {
    if (!AUDIENCES[audience]) throw new HttpError(400, 'Đối tượng hồ sơ không hợp lệ');
    const items = await admissionItemRepository.list(db, { year: year(), kind: 'DOC_CHECKLIST', audience, majorCode });
    return items.map((i) => ({ ...i, copyTypeLabel: COPY_TYPES[i.copy_type] || null }));
  }

  async function schedule() {
    const today = vnToday();
    const items = await admissionItemRepository.list(db, { year: year(), kind: 'SCHEDULE' });
    return items.map((i) => ({ ...i, status: scheduleStatus(i, today) }));
  }

  const contacts = () => admissionItemRepository.list(db, { year: year(), kind: 'CONTACT' });

  /** Giải thích hệ đào tạo (SC, 9+, TC, CĐ) và loại hỗ trợ học phí (Nhà nước, Doanh nghiệp, Sinh viên). */
  async function info() {
    const rows = await admissionItemRepository.listInfo(db, year());
    const pick = (kind) => Object.fromEntries(rows.filter((r) => r.kind === kind && r.code).map((r) => [r.code, { title: r.title, detail: r.detail }]));
    return { levels: pick('LEVEL_INFO'), supports: pick('SUPPORT_INFO') };
  }
  const guideSteps = () => admissionItemRepository.list(db, { year: year(), kind: 'ONLINE_GUIDE_STEP' });

  async function faqByTopic() {
    const { rows } = await db.query(
      `SELECT id, code, topic, question, answer, source_codes, reliability FROM faq_entries
        WHERE status = 'APPROVED' AND admission_year = ? ORDER BY code NULLS LAST, id`,
      [year()],
    );
    return rows;
  }

  async function sources() {
    const { rows } = await db.query(
      `SELECT source_code, title, source_url, issued_date, status FROM kb_documents WHERE source_code IS NOT NULL ORDER BY source_code`,
    );
    return rows;
  }

  async function overview() {
    const [majors, faculties, sched] = await Promise.all([
      majorRepository.listActive(db, { year: year() }),
      majorRepository.faculties(db, year()),
      schedule(),
    ]);
    const { rows: q9 } = await db.query('SELECT COALESCE(SUM(COALESCE(quota_9plus_cs1,0) + COALESCE(quota_9plus_cs2,0)),0)::int AS n FROM majors WHERE is_active AND admission_year = ?', [year()]);
    return {
      majorCount: majors.length,
      faculties,
      levelCounts: Object.fromEntries(Object.keys(LEVELS).map((l) => [l, majors.filter((m) => m.levels.includes(l)).length])),
      quota9Plus: q9[0].n,
      ongoingSchedule: sched.filter((s) => s.status === 'ONGOING'),
      upcomingSchedule: sched.filter((s) => s.status === 'UPCOMING').slice(0, 3),
    };
  }

  const meta = () => ({ levels: LEVELS, audiences: AUDIENCES, topics: TOPICS, copyTypes: COPY_TYPES, config: configService.getPublic(), admissionYear: year() });

  return { listMajors, majorDetail, checklist, schedule, contacts, guideSteps, info, faqByTopic, sources, overview, meta };
}

module.exports = { createHandbookService, scheduleStatus };
