'use strict';
/** M6 – Đặt lịch hẹn nộp hồ sơ (thí sinh). Mã hẹn là "chìa khóa": không trả SĐT/email qua kênh công khai. */
const express = require('express');
const v = require('../utils/validate');
const ah = require('../utils/asyncHandler');
const { AUDIENCES } = require('../constants/catalog');

const DOC_CODE = /^[A-Z_]{2,40}$/;

module.exports = function appointmentRoutes({ appointmentService, visitorHash, limits }) {
  const r = express.Router();

  r.get('/slots', ah(async (req, res) => res.json(await appointmentService.availableSlots({ from: v.date(req.query, 'from'), to: v.date(req.query, 'to') }))));

  r.post('/checklist/evaluate', ah(async (req, res) => {
    const out = await appointmentService.evaluateChecklist({
      audience: v.oneOf(req.body, 'audience', Object.keys(AUDIENCES), { required: true, label: 'Đối tượng' }),
      majorCode: v.str(req.body, 'majorCode', { max: 60 }),
      confirmedDocCodes: v.strArray(req.body, 'confirmedDocCodes', { pattern: DOC_CODE }),
    });
    res.json(out);
  }));

  r.post('/', limits.booking, ah(async (req, res) => {
    res.status(201).json(await appointmentService.book({
      audience: v.oneOf(req.body, 'audience', Object.keys(AUDIENCES), { required: true, label: 'Đối tượng' }),
      majorCode: v.str(req.body, 'majorCode', { max: 60 }),
      slotId: v.int(req.body, 'slotId', { label: 'Khung giờ', required: true, min: 1 }),
      confirmedDocCodes: v.strArray(req.body, 'confirmedDocCodes', { pattern: DOC_CODE }),
      contactName: v.str(req.body, 'contactName', { label: 'Họ tên', max: 100 }),
      contactPhone: v.phone(req.body, 'contactPhone'),
      contactEmail: v.email(req.body, 'contactEmail'),
      consent: v.bool(req.body, 'consent', { fallback: false }),
      visitorHash: visitorHash(req),
    }));
  }));

  // Quên mã hẹn (đặt TRƯỚC '/:code'): SĐT + ngày hẹn phải khớp; giới hạn tần suất riêng.
  r.post('/recover', limits.codeRecover, ah(async (req, res) => res.json(await appointmentService.recover({
    phone: v.phone(req.body, 'phone', { required: true }),
    date: v.date(req.body, 'date', { label: 'Ngày hẹn', required: true }),
  }))));

  r.get('/:code', limits.codeLookup, ah(async (req, res) => res.json(await appointmentService.view(req.params.code))));
  r.post('/:code/cancel', limits.codeLookup, ah(async (req, res) => res.json(await appointmentService.cancel(req.params.code))));
  r.post('/:code/reschedule', limits.codeLookup, ah(async (req, res) => {
    res.json(await appointmentService.reschedule(req.params.code, v.int(req.body, 'slotId', { label: 'Khung giờ', required: true, min: 1 })));
  }));
  r.get('/:code/ics', limits.codeLookup, ah(async (req, res) => {
    const a = await appointmentService.view(req.params.code);
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="lich-hen-${a.code}.ics"`);
    res.send(appointmentService.ics(a));
  }));
  return r;
};
