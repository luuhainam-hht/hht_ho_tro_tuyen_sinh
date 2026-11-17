'use strict';
/**
 * Quản lý dữ liệu cẩm nang:
 *   /majors           – ngành học (MAJOR_MANAGE). Cán bộ Khoa chỉ thấy/sửa/thêm ngành của KHOA MÌNH.
 *   /admission-items  – hồ sơ, đợt nhận hồ sơ, hướng dẫn, liên hệ, giải thích hệ/hỗ trợ học phí (ADMISSION_INFO).
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
const admissionItemRepository = require('../repositories/admissionItemRepository');
const auditRepository = require('../repositories/auditRepository');

const LEVEL_CODES = Object.keys(LEVELS);
const ITEM_KINDS = ['DOC_CHECKLIST', 'SCHEDULE', 'ONLINE_GUIDE_STEP', 'CONTACT', 'LEVEL_INFO', 'SUPPORT_INFO'];
const MAJOR_CODE = /^[A-Za-z0-9._-]{2,30}$/;
/** Tham số liên hệ Phòng Tuyển sinh được sửa (không gồm tham số kỹ thuật như nhúng iframe, lưu dữ liệu). */
const CONTACT_KEYS = ['HOTLINE', 'ADMISSION_EMAIL', 'SUBMISSION_ADDRESS', 'OFFICIAL_REGISTER_URL', 'FANPAGE_URL', 'SCHOOL_NAME', 'CHAT_GREETING', 'HANDOFF_ENABLED'];

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
  };
  if (body?.detail === '') fields.detail = '';
  if (body?.dateFrom === '') fields.date_from = null;
  if (body?.dateTo === '') fields.date_to = null;
  if (fields.date_from && fields.date_to && fields.date_from > fields.date_to) throw new HttpError(400, 'Ngày bắt đầu phải trước ngày kết thúc');
  return fields;
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
    res.json({ majors: fac ? all.filter((m) => m.faculty === fac) : all, scopeFaculty: fac, faculties: [...new Set(all.map((m) => m.faculty))].sort() });
  }));

  majors.post('/', ah(async (req, res) => {
    const fac = scopedFaculty(req.user);
    // Cán bộ Khoa luôn thêm ngành vào khoa của mình (bỏ qua khoa gửi lên).
    const fields = majorFields(fac ? { ...req.body, faculty: fac } : req.body, { creating: true });
    const code = v.str(req.body, 'code', { label: 'Mã ngành', required: true, max: 30, pattern: MAJOR_CODE, patternMessage: 'Mã ngành chỉ gồm chữ, số, dấu chấm, gạch (2–30 ký tự)' });
    const major = await db.withTransaction(async (c) => {
      const created = await majorRepository.insert(c, {
        ...definedOnly(fields), code, occupation_code: v.str(req.body, 'occupationCode', { max: 30 }) || code, admission_year: year(),
      });
      if (!created) throw new HttpError(409, 'Mã ngành đã tồn tại');
      await auditRepository.insert(c, { actorId: req.user.id, action: 'MAJOR_CREATE', targetType: 'MAJOR', targetId: code, payload: definedOnly(fields), ip: req.ip });
      return created;
    });
    broadcast('CATALOG_UPDATED', { type: 'MAJOR', code });
    res.status(201).json({ major });
  }));

  majors.put('/:code', ah(async (req, res) => {
    const code = v.str(req.params, 'code', { required: true, max: 60 });
    const fields = majorFields(req.body);
    const fac = scopedFaculty(req.user);
    if (fac && fields.faculty !== undefined && fields.faculty !== fac) throw new HttpError(403, 'Cán bộ Khoa không chuyển ngành sang khoa khác');
    const major = await db.withTransaction(async (c) => {
      const cur = await majorRepository.findByCodeForUpdate(c, code);
      if (!cur) throw new HttpError(404, 'Không tìm thấy ngành');
      if (fac && cur.faculty !== fac) throw new HttpError(403, `Bạn chỉ được sửa ngành của khoa ${fac}`);
      const merged = { state: fields.state_support !== undefined ? fields.state_support : cur.state_support, ent: fields.enterprise_support !== undefined ? fields.enterprise_support : cur.enterprise_support };
      const pct = (s) => { const m = /^(\d{1,3})%$/.exec(s || ''); return m ? Number(m[1]) : 0; };
      if (pct(merged.state) + pct(merged.ent) > 100) throw new HttpError(400, 'Tổng mức hỗ trợ Nhà nước + Doanh nghiệp vượt quá 100%');
      const u = await majorRepository.update(c, code, fields);
      await auditRepository.insert(c, { actorId: req.user.id, action: 'MAJOR_UPDATE', targetType: 'MAJOR', targetId: code, payload: definedOnly(fields), ip: req.ip });
      return u;
    });
    broadcast('CATALOG_UPDATED', { type: 'MAJOR', code });
    res.json({ major });
  }));
  r.use('/majors', majors);

  // ---------------- Mục cẩm nang: hồ sơ, đợt nhận hồ sơ, liên hệ, giải thích hệ… ----------------
  const items = express.Router();
  items.use(requirePermission('ADMISSION_INFO'));

  items.get('/', ah(async (_req, res) => res.json({ items: await admissionItemRepository.listAllForAdmin(db, year()) })));

  items.post('/', ah(async (req, res) => {
    const kind = v.oneOf(req.body, 'kind', ITEM_KINDS, { required: true, label: 'Loại mục' });
    const fields = itemFields(req.body, { creating: true });
    const item = await db.withTransaction(async (c) => {
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
module.exports.CONTACT_KEYS = CONTACT_KEYS;
