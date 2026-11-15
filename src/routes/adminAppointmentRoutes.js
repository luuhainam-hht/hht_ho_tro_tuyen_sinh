'use strict';
const express = require('express');
const v = require('../utils/validate');
const ah = require('../utils/asyncHandler');
const { requirePermission } = require('../middleware/auth');
const { vnToday } = require('../utils/time');

module.exports = function adminAppointmentRoutes({ appointmentService }) {
  const r = express.Router();
  r.use(requirePermission('APPOINTMENT_MANAGE'));
  const o = (req) => ({ actor: req.user, ip: req.ip, note: v.str(req.body, 'note', { max: 500 }) });
  r.get('/calendar', ah(async (req, res) => res.json(await appointmentService.adminCalendar({ from: v.date(req.query, 'from'), to: v.date(req.query, 'to') }))));
  r.get('/day', ah(async (req, res) => res.json(await appointmentService.adminDay(v.date(req.query, 'date') || vnToday()))));
  r.get('/lookup/:code', ah(async (req, res) => res.json(await appointmentService.view(req.params.code, { includeContact: true }))));
  r.post('/:code/check-in', ah(async (req, res) => res.json(await appointmentService.checkIn(req.params.code, o(req)))));
  r.post('/:code/complete', ah(async (req, res) => res.json(await appointmentService.complete(req.params.code, o(req)))));
  r.post('/:code/cancel', ah(async (req, res) => res.json(await appointmentService.cancel(req.params.code, o(req)))));
  r.put('/slots/:id', ah(async (req, res) => res.json(await appointmentService.updateSlot(v.idParam(req.params), {
    capacity: v.int(req.body, 'capacity', { label: 'Sức chứa', min: 0, max: 1000 }) ?? undefined,
    isClosed: v.bool(req.body, 'isClosed') ?? undefined,
    actor: req.user, ip: req.ip,
  }))));
  r.post('/holidays', ah(async (req, res) => res.json(await appointmentService.setHoliday({
    day: v.date(req.body, 'day', { label: 'Ngày', required: true }),
    reason: v.str(req.body, 'reason', { label: 'Lý do', max: 200 }) || 'Nghỉ',
    remove: v.bool(req.body, 'remove', { fallback: false }),
    actor: req.user, ip: req.ip,
  }))));
  r.post('/generate-slots', ah(async (_req, res) => res.json(await appointmentService.generateSlots())));
  return r;
};
