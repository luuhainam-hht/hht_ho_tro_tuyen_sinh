'use strict';
/** Sửa ngành và mục cẩm nang (hồ sơ, lịch, liên hệ). Mọi thay đổi ghi audit_logs. */
const express = require('express');
const v = require('../utils/validate');
const ah = require('../utils/asyncHandler');
const { HttpError } = require('../utils/httpError');
const { requirePermission } = require('../middleware/auth');
const { LEVELS } = require('../constants/catalog');
const majorRepository = require('../repositories/majorRepository');
const admissionItemRepository = require('../repositories/admissionItemRepository');
const auditRepository = require('../repositories/auditRepository');

const LEVEL_CODES = Object.keys(LEVELS);

module.exports = function adminMajorRoutes({ db, configService }) {
  const r = express.Router();
  r.use(requirePermission('KB_MANAGE'));

  r.get('/majors', ah(async (_req, res) => res.json({ majors: await majorRepository.listAll(db) })));
  r.put('/majors/:code', ah(async (req, res) => {
    const code = v.str(req.params, 'code', { required: true, max: 60 });
    const levels = req.body?.levels === undefined ? undefined : v.strArray(req.body, 'levels', { label: 'Hệ đào tạo', maxItems: 4 });
    if (levels && !levels.every((l) => LEVEL_CODES.includes(l))) throw new HttpError(400, 'Hệ đào tạo không hợp lệ');
    const fields = {
      name: v.str(req.body, 'name', { label: 'Tên ngành', max: 200 }) ?? undefined,
      description: v.str(req.body, 'description', { max: 3000 }) ?? undefined,
      levels,
      quota: v.int(req.body, 'quota', { min: 0, max: 100000 }) ?? undefined,
      tuition_per_month_min: v.int(req.body, 'tuitionPerMonthMin', { min: 0, max: 100000000 }) ?? undefined,
      tuition_per_month_max: v.int(req.body, 'tuitionPerMonthMax', { min: 0, max: 100000000 }) ?? undefined,
      state_support: v.str(req.body, 'stateSupport', { max: 100 }) ?? undefined,
      enterprise_support: v.str(req.body, 'enterpriseSupport', { max: 100 }) ?? undefined,
      support_needs_verify: v.bool(req.body, 'supportNeedsVerify') ?? undefined,
      duration: v.str(req.body, 'duration', { max: 100 }) ?? undefined,
      is_active: v.bool(req.body, 'isActive') ?? undefined,
      internal_note: v.str(req.body, 'internalNote', { max: 1000 }) ?? undefined,
    };
    const major = await db.withTransaction(async (c) => {
      const cur = await majorRepository.findByCodeForUpdate(c, code);
      if (!cur) throw new HttpError(404, 'Không tìm thấy ngành');
      const u = await majorRepository.update(c, code, fields);
      await auditRepository.insert(c, { actorId: req.user.id, action: 'MAJOR_UPDATE', targetType: 'MAJOR', targetId: code, payload: Object.fromEntries(Object.entries(fields).filter(([, x]) => x !== undefined)), ip: req.ip });
      return u;
    });
    res.json({ major });
  }));

  r.get('/admission-items', ah(async (_req, res) => res.json({ items: await admissionItemRepository.listAllForAdmin(db, configService.get('CURRENT_ADMISSION_YEAR')) })));
  r.put('/admission-items/:id', ah(async (req, res) => {
    const id = v.idParam(req.params);
    const fields = {
      title: v.str(req.body, 'title', { max: 300 }) ?? undefined,
      detail: v.str(req.body, 'detail', { max: 3000 }) ?? undefined,
      note: v.str(req.body, 'note', { max: 1000 }) ?? undefined,
      is_mandatory: v.bool(req.body, 'isMandatory') ?? undefined,
      date_from: v.date(req.body, 'dateFrom') ?? undefined,
      date_to: v.date(req.body, 'dateTo') ?? undefined,
      is_active: v.bool(req.body, 'isActive') ?? undefined,
    };
    const item = await db.withTransaction(async (c) => {
      if (!(await admissionItemRepository.findByIdForUpdate(c, id))) throw new HttpError(404, 'Không tìm thấy mục');
      const u = await admissionItemRepository.update(c, id, fields);
      await auditRepository.insert(c, { actorId: req.user.id, action: 'ADMISSION_ITEM_UPDATE', targetType: 'ADMISSION_ITEM', targetId: id, ip: req.ip });
      return u;
    });
    res.json({ item });
  }));
  return r;
};
