'use strict';
/**
 * Quản lý dữ liệu cẩm nang:
 *   /majors           – ngành học + bảng thông tin tuyển sinh theo hệ (MAJOR_MANAGE). Cán bộ Khoa chỉ thấy/sửa/thêm
 *                       ngành của KHOA MÌNH.
 *   /admission-items  – hồ sơ, đợt nhận hồ sơ, hướng dẫn, liên hệ, giải thích hệ/hỗ trợ học phí (ADMISSION_INFO).
 *                       Cán bộ Khoa xem mục chung (chỉ đọc) và thêm/sửa/xóa mục gắn với ngành của khoa mình.
 *   /contact-configs  – hotline, email, địa chỉ nộp hồ sơ, lời chào (CONTACT_CONFIG).
 * Mọi thay đổi ghi audit_logs và phát sự kiện realtime để trang quản trị khác tự tải lại.
 */
const express = require('express');
const v = require('../utils/validate');
const ah = require('../utils/asyncHandler');
const { HttpError } = require('../utils/httpError');
const { requirePermission } = require('../middleware/auth');
const { LEVELS, COPY_TYPES } = require('../constants/catalog');
const { FACULTY_SCOPED_ROLES } = require('../constants/roles');
const majorRepository = require('../repositories/majorRepository');
const majorProgramRepository = require('../repositories/majorProgramRepository');
const admissionItemRepository = require('../repositories/admissionItemRepository');
const auditRepository = require('../repositories/auditRepository');

const LEVEL_CODES = Object.keys(LEVELS);
const ITEM_KINDS = ['DOC_CHECKLIST', 'SCHEDULE', 'ONLINE_GUIDE_STEP', 'CONTACT', 'LEVEL_INFO', 'SUPPORT_INFO'];
const MAJOR_CODE = /^[A-Za-z0-9._-]{2,30}$/;
/** Tham số liên hệ Phòng Tuyển sinh được sửa (không gồm tham số kỹ thuật như nhúng iframe, lưu dữ liệu). */
const CONTACT_KEYS = ['HOTLINE', 'ADMISSION_EMAIL', 'SUBMISSION_ADDRESS', 'OFFICIAL_REGISTER_URL', 'FANPAGE_URL', 'FACULTY_PAGES', 'SCHOOL_NAME', 'CHAT_GREETING', 'HANDOFF_ENABLED'];

const scopedFaculty = (user) => (FACULTY_SCOPED_ROLES.includes(user.role) ? user.faculty : null);

/** Hỗ trợ học phí nhập "70%", "70", "30 %" -> chuẩn hóa "70%"; chữ tự do (ví dụ "theo NQ 57") giữ nguyên. */
function normalizeSupport(raw) {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const m = /^(\d{1,3})(?:[.,]\d+)?\s*%?$/.exec(s);
  if (m) {
    const n = Number(m[1]);
    if (n > 100) throw new HttpError(400, 'Mức hỗ trợ học phí không vượt quá 100%');
    return `${n}%`;
  }
  return s.slice(0, 100);
}

function majorFields(body, { creating = false } = {}) {
  const levels = body?.levels === undefined ? undefined : v.strArray(body, 'levels', { label: 'Hệ đào tạo', maxItems: 4 });
  if (levels && !levels.every((l) => LEVEL_CODES.includes(l))) throw new HttpError(400, 'Hệ đào tạo không hợp lệ');
  const fields = {
    name: v.str(body, 'name', { label: 'Tên ngành', max: 200, required: creating }) ?? undefined,
    faculty: v.str(body, 'faculty', { label: 'Khoa', max: 100, required: creating }) ?? undefined,
    description: v.str(body, 'description', { max: 3000 }) ?? undefined,
    levels,
    quota: v.int(body, 'quota', { min: 0, max: 100000 }) ?? undefined,
    quota_9plus_cs1: v.int(body, 'quota9PlusCs1', { min: 0, max: 100000 }) ?? undefined,
    quota_9plus_cs2: v.int(body, 'quota9PlusCs2', { min: 0, max: 100000 }) ?? undefined,
    tuition_per_month_min: v.int(body, 'tuitionPerMonthMin', { label: 'Học phí thấp nhất', min: 0, max: 100000000 }) ?? undefined,
    tuition_per_month_max: v.int(body, 'tuitionPerMonthMax', { label: 'Học phí cao nhất', min: 0, max: 100000000 }) ?? undefined,
    state_support: normalizeSupport(body?.stateSupport),
    enterprise_support: normalizeSupport(body?.enterpriseSupport),
    support_needs_verify: v.bool(body, 'supportNeedsVerify') ?? undefined,
    duration: v.str(body, 'duration', { max: 100 }) ?? undefined,
    is_active: v.bool(body, 'isActive') ?? undefined,
    internal_note: v.str(body, 'internalNote', { max: 1000 }) ?? undefined,
  };
  // Cho phép xóa trắng mức hỗ trợ (gửi chuỗi rỗng) – normalizeSupport trả null.
  if (body?.stateSupport === '') fields.state_support = null;
  if (body?.enterpriseSupport === '') fields.enterprise_support = null;
  const pct = (s) => { const m = /^(\d{1,3})%$/.exec(s || ''); return m ? Number(m[1]) : 0; };
  if (pct(fields.state_support) + pct(fields.enterprise_support) > 100) throw new HttpError(400, 'Tổng mức hỗ trợ Nhà nước + Doanh nghiệp vượt quá 100%');
  return fields;
}

function itemFields(body, { creating = false } = {}) {
  const fields = {
    title: v.str(body, 'title', { label: 'Tiêu đề', max: 300, required: creating }) ?? undefined,
    detail: v.str(body, 'detail', { label: 'Nội dung', max: 3000 }) ?? undefined,
    audience: v.str(body, 'audience', { label: 'Đối tượng / nhóm', max: 120 }) ?? undefined,
    code: v.str(body, 'code', { label: 'Mã giấy tờ', max: 30 }) ?? undefined,
    note: v.str(body, 'note', { max: 1000 }) ?? undefined,
    is_mandatory: v.bool(body, 'isMandatory') ?? undefined,
    copy_type: v.oneOf(body, 'copyType', Object.keys(COPY_TYPES)) ?? undefined,
    quantity: v.int(body, 'quantity', { label: 'Số lượng', min: 1, max: 50 }) ?? undefined,
    order_no: v.int(body, 'orderNo', { label: 'Thứ tự', min: 0, max: 10000 }) ?? undefined,
    date_from: v.date(body, 'dateFrom') ?? undefined,
    date_to: v.date(body, 'dateTo') ?? undefined,
    is_active: v.bool(body, 'isActive') ?? undefined,
    major_code: v.str(body, 'majorCode', { label: 'Ngành áp dụng', max: 60 }) ?? undefined,
  };
  if (body?.majorCode === '' || body?.majorCode === null) fields.major_code = null; // áp dụng mọi ngành
  if (body?.detail === '') fields.detail = '';
  if (body?.dateFrom === '') fields.date_from = null;
  if (body?.dateTo === '') fields.date_to = null;
  if (fields.date_from && fields.date_to && fields.date_from > fields.date_to) throw new HttpError(400, 'Ngày bắt đầu phải trước ngày kết thúc');
  return fields;
}

/**
 * Bảng thông tin tuyển sinh theo hệ: [{ level, quotaCs1, quotaCs2, quotaCs3, duration, tuitionMin, tuitionMax,
 * tuitionNote, methods, note }]. Hệ có trong mảng = ngành có tuyển hệ đó.
 */
function programFields(body) {
  if (body?.programs === undefined) return undefined;
  if (!Array.isArray(body.programs) || body.programs.length > LEVEL_CODES.length) throw new HttpError(400, 'Bảng thông tin tuyển sinh không hợp lệ');
  const seen = new Set();
  return body.programs.map((p) => {
    const level = v.oneOf(p, 'level', LEVEL_CODES, { required: true, label: 'Hệ tuyển sinh' });
    if (seen.has(level)) throw new HttpError(400, 'Mỗi hệ chỉ khai báo một lần');
    seen.add(level);
    const name = majorProgramRepository.LEVEL_SHORT[level];
    const q = (k, n) => v.int(p, k, { label: `Chỉ tiêu ${name} – Cơ sở ${n}`, min: 0, max: 100000 });
    const out = {
      level,
      quota_cs1: q('quotaCs1', 1), quota_cs2: q('quotaCs2', 2), quota_cs3: q('quotaCs3', 3),
      duration: v.str(p, 'duration', { label: `Thời gian học ${name}`, max: 150 }),
      tuition_min: v.int(p, 'tuitionMin', { label: `Học phí thấp nhất ${name}`, min: 0, max: 100000000 }),
      tuition_max: v.int(p, 'tuitionMax', { label: `Học phí cao nhất ${name}`, min: 0, max: 100000000 }),
      tuition_note: v.str(p, 'tuitionNote', { label: `Ghi chú học phí ${name}`, max: 300 }),
      methods: v.str(p, 'methods', { label: `Phương thức xét tuyển ${name}`, max: 500 }),
      note: v.str(p, 'note', { label: `Ghi chú ${name}`, max: 500 }),
    };
    if (out.tuition_min !== null && out.tuition_max !== null && out.tuition_min > out.tuition_max) throw new HttpError(400, `Học phí ${name}: mức thấp nhất lớn hơn mức cao nhất`);
    return out;
  });
}

/** Lưu bảng theo hệ rồi đồng bộ majors.levels/duration/chỉ tiêu 9+/học phí (cùng transaction). */
async function savePrograms(c, code, programs) {
  if (programs === undefined) {
    // Bản giao diện cũ không gửi bảng: tạo bảng mặc định cho hệ vừa chọn (nếu chưa có).
    await majorProgramRepository.backfillMissing(c);
    return majorProgramRepository.listByMajor(c, code);
  }
  await majorProgramRepository.replaceForMajor(c, code, programs);
  return majorProgramRepository.syncMajorSummary(c, code);
}

const definedOnly = (o) => Object.fromEntries(Object.entries(o).filter(([, x]) => x !== undefined));

module.exports = function adminMajorRoutes({ db, configService, broadcast = () => {} }) {
  const r = express.Router();
  const year = () => configService.get('CURRENT_ADMISSION_YEAR');

  // ---------------- Ngành học ----------------
  const majors = express.Router();
  majors.use(requirePermission('MAJOR_MANAGE'));

  majors.get('/', ah(async (req, res) => {
    const fac = scopedFaculty(req.user);
    const all = await majorRepository.listAll(db);
    const shown = fac ? all.filter((m) => m.faculty === fac) : all;
    const programs = await majorProgramRepository.mapByMajors(db, shown.map((m) => m.code));
    res.json({
      majors: shown.map((m) => ({ ...m, programs: programs.get(m.code) || [] })),
      scopeFaculty: fac, faculties: [...new Set(all.map((m) => m.faculty))].sort(),
    });
  }));

  majors.post('/', ah(async (req, res) => {
    const fac = scopedFaculty(req.user);
    // Cán bộ Khoa luôn thêm ngành vào khoa của mình (bỏ qua khoa gửi lên).
    const fields = majorFields(fac ? { ...req.body, faculty: fac } : req.body, { creating: true });
    const programs = programFields(req.body);
    const code = v.str(req.body, 'code', { label: 'Mã ngành', required: true, max: 30, pattern: MAJOR_CODE, patternMessage: 'Mã ngành chỉ gồm chữ, số, dấu chấm, gạch (2–30 ký tự)' });
    const major = await db.withTransaction(async (c) => {
      const created = await majorRepository.insert(c, {
        ...definedOnly(fields), code, occupation_code: v.str(req.body, 'occupationCode', { max: 30 }) || code, admission_year: year(),
      });
      if (!created) throw new HttpError(409, 'Mã ngành đã tồn tại');
      const saved = await savePrograms(c, code, programs);
      await auditRepository.insert(c, { actorId: req.user.id, action: 'MAJOR_CREATE', targetType: 'MAJOR', targetId: code, payload: { ...definedOnly(fields), programs }, ip: req.ip });
      return { ...(await majorRepository.findByCodeForUpdate(c, code)), programs: saved };
    });
    broadcast('CATALOG_UPDATED', { type: 'MAJOR', code });
    res.status(201).json({ major });
  }));

  majors.put('/:code', ah(async (req, res) => {
    const code = v.str(req.params, 'code', { required: true, max: 60 });
    const fields = majorFields(req.body);
    const programs = programFields(req.body);
    if (programs) delete fields.levels; // hệ tuyển sinh lấy theo bảng thông tin tuyển sinh
    const fac = scopedFaculty(req.user);
    if (fac && fields.faculty !== undefined && fields.faculty !== fac) throw new HttpError(403, 'Cán bộ Khoa không chuyển ngành sang khoa khác');
    const major = await db.withTransaction(async (c) => {
      const cur = await majorRepository.findByCodeForUpdate(c, code);
      if (!cur) throw new HttpError(404, 'Không tìm thấy ngành');
      if (fac && cur.faculty !== fac) throw new HttpError(403, `Bạn chỉ được sửa ngành của khoa ${fac}`);
      const merged = { state: fields.state_support !== undefined ? fields.state_support : cur.state_support, ent: fields.enterprise_support !== undefined ? fields.enterprise_support : cur.enterprise_support };
      const pct = (s) => { const m = /^(\d{1,3})%$/.exec(s || ''); return m ? Number(m[1]) : 0; };
      if (pct(merged.state) + pct(merged.ent) > 100) throw new HttpError(400, 'Tổng mức hỗ trợ Nhà nước + Doanh nghiệp vượt quá 100%');
      // Chỉ gửi bảng theo hệ (không sửa cột nào của majors) thì bỏ qua bước cập nhật majors.
      if (Object.keys(definedOnly(fields)).length || !programs) await majorRepository.update(c, code, fields);
      const saved = await savePrograms(c, code, programs);
      await auditRepository.insert(c, { actorId: req.user.id, action: 'MAJOR_UPDATE', targetType: 'MAJOR', targetId: code, payload: { ...definedOnly(fields), programs }, ip: req.ip });
      return { ...(await majorRepository.findByCodeForUpdate(c, code)), programs: saved };
    });
    broadcast('CATALOG_UPDATED', { type: 'MAJOR', code });
    res.json({ major });
  }));
  r.use('/majors', majors);

  // ---------------- Mục cẩm nang: hồ sơ, đợt nhận hồ sơ, liên hệ, giải thích hệ… ----------------
  const items = express.Router();
  items.use(requirePermission('ADMISSION_INFO'));

  /**
   * Phạm vi của Cán bộ Khoa: chỉ thao tác mục gắn với ngành thuộc khoa mình (major_code), không sửa mục chung
   * và không sửa giải thích hệ/hỗ trợ học phí. Trả null nếu người dùng không bị giới hạn theo khoa.
   */
  async function facultyMajorCodes(c, user) {
    const fac = scopedFaculty(user);
    if (!fac) return null;
    const { rows } = await c.query('SELECT code FROM majors WHERE faculty = ?', [fac]);
    return new Set(rows.map((x) => x.code));
  }
  const FACULTY_KINDS = ['DOC_CHECKLIST', 'SCHEDULE', 'ONLINE_GUIDE_STEP', 'CONTACT'];
  function assertFacultyItem(own, { kind, majorCode }) {
    if (!own) return;
    if (!FACULTY_KINDS.includes(kind)) throw new HttpError(403, 'Cán bộ Khoa không sửa phần giải thích hệ đào tạo/hỗ trợ học phí');
    if (!majorCode || !own.has(majorCode)) throw new HttpError(403, 'Cán bộ Khoa chỉ thêm/sửa mục gắn với ngành của khoa mình');
  }
  async function assertMajorExists(c, majorCode) {
    if (majorCode && !(await majorRepository.findByCode(c, majorCode))) throw new HttpError(400, 'Ngành áp dụng không tồn tại');
  }

  items.get('/', ah(async (req, res) => {
    const all = await admissionItemRepository.listAllForAdmin(db, year());
    const own = await facultyMajorCodes(db, req.user);
    const { rows: majorList } = await db.query(
      own ? 'SELECT code, name, faculty FROM majors WHERE faculty = ? ORDER BY name' : 'SELECT code, name, faculty FROM majors ORDER BY faculty, name',
      own ? [scopedFaculty(req.user)] : [],
    );
    res.json({
      items: all.map((i) => ({ ...i, can_edit: !own || (FACULTY_KINDS.includes(i.kind) && own.has(i.major_code)) })),
      majors: majorList, scopeFaculty: scopedFaculty(req.user),
    });
  }));

  items.post('/', ah(async (req, res) => {
    const kind = v.oneOf(req.body, 'kind', ITEM_KINDS, { required: true, label: 'Loại mục' });
    const fields = itemFields(req.body, { creating: true });
    const item = await db.withTransaction(async (c) => {
      assertFacultyItem(await facultyMajorCodes(c, req.user), { kind, majorCode: fields.major_code });
      await assertMajorExists(c, fields.major_code);
      const created = await admissionItemRepository.insert(c, { ...definedOnly(fields), kind, admission_year: year() });
      await auditRepository.insert(c, { actorId: req.user.id, action: 'ADMISSION_ITEM_CREATE', targetType: 'ADMISSION_ITEM', targetId: created.id, payload: { kind, title: created.title }, ip: req.ip });
      return created;
    });
    broadcast('CATALOG_UPDATED', { type: 'ADMISSION_ITEM', kind });
    res.status(201).json({ item });
  }));

  items.put('/:id', ah(async (req, res) => {
    const id = v.idParam(req.params);
    const fields = itemFields(req.body);
    const item = await db.withTransaction(async (c) => {
      const cur = await admissionItemRepository.findByIdForUpdate(c, id);
      if (!cur) throw new HttpError(404, 'Không tìm thấy mục');
      const own = await facultyMajorCodes(c, req.user);
      assertFacultyItem(own, { kind: cur.kind, majorCode: cur.major_code });
      if (fields.major_code !== undefined) { assertFacultyItem(own, { kind: cur.kind, majorCode: fields.major_code }); await assertMajorExists(c, fields.major_code); }
      const from = fields.date_from !== undefined ? fields.date_from : cur.date_from && String(cur.date_from).slice(0, 10);
      const to = fields.date_to !== undefined ? fields.date_to : cur.date_to && String(cur.date_to).slice(0, 10);
      if (from && to && from > to) throw new HttpError(400, 'Ngày bắt đầu phải trước ngày kết thúc');
      const u = await admissionItemRepository.update(c, id, fields);
      await auditRepository.insert(c, { actorId: req.user.id, action: 'ADMISSION_ITEM_UPDATE', targetType: 'ADMISSION_ITEM', targetId: id, payload: definedOnly(fields), ip: req.ip });
      return u;
    });
    broadcast('CATALOG_UPDATED', { type: 'ADMISSION_ITEM', kind: item.kind });
    res.json({ item });
  }));

  items.delete('/:id', ah(async (req, res) => {
    const id = v.idParam(req.params);
    const removed = await db.withTransaction(async (c) => {
      const cur = await admissionItemRepository.findByIdForUpdate(c, id);
      if (!cur) throw new HttpError(404, 'Không tìm thấy mục');
      assertFacultyItem(await facultyMajorCodes(c, req.user), { kind: cur.kind, majorCode: cur.major_code });
      await admissionItemRepository.remove(c, id);
      await auditRepository.insert(c, { actorId: req.user.id, action: 'ADMISSION_ITEM_DELETE', targetType: 'ADMISSION_ITEM', targetId: id, payload: { kind: cur.kind, title: cur.title, detail: cur.detail }, ip: req.ip });
      return cur;
    });
    broadcast('CATALOG_UPDATED', { type: 'ADMISSION_ITEM', kind: removed.kind });
    res.json({ ok: true });
  }));
  r.use('/admission-items', items);

  // ---------------- Thông tin liên hệ chung ----------------
  const contact = express.Router();
  contact.use(requirePermission('CONTACT_CONFIG'));
  contact.get('/', (_req, res) => res.json({ configs: configService.list().filter((cfg) => CONTACT_KEYS.includes(cfg.key)) }));
  contact.put('/:key', ah(async (req, res) => {
    const key = v.oneOf(req.params, 'key', CONTACT_KEYS, { required: true, label: 'Tham số' });
    const row = await configService.update(key, v.str(req.body, 'value', { label: 'Giá trị', max: 2000 }) ?? '', { actorId: req.user.id, ip: req.ip });
    res.json({ config: { key: row.key, value: row.value } });
  }));
  r.use('/contact-configs', contact);
  return r;
};

module.exports.normalizeSupport = normalizeSupport;
module.exports.programFields = programFields;
module.exports.CONTACT_KEYS = CONTACT_KEYS;
