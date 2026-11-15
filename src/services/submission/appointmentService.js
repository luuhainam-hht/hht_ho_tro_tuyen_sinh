'use strict';
/**
 * M6 (nhánh "chuẩn bị ở nhà") – Đặt lịch hẹn nộp hồ sơ. KHÔNG cấp số thứ tự; thí sinh nhận MÃ HẸN.
 *   BOOKED -> CHECKED_IN -> COMPLETED      BOOKED -> CANCELLED      BOOKED -> NO_SHOW (job cuối ngày)
 * Mỗi chuyển trạng thái: withTransaction -> FOR UPDATE -> kiểm tra trạng thái nguồn -> cập nhật
 * -> appointment_history (+ audit_logs nếu cán bộ thao tác) -> COMMIT -> broadcast.
 * Chống đặt vượt sức chứa: khóa dòng slot (FOR UPDATE) + CHECK booked_count <= capacity ở DB.
 */
const { HttpError } = require('../../utils/httpError');
const { uuid } = require('../../utils/crypto');
const { NOW } = require('../../utils/sqlUpdate');
const { vnToday, addDays, vnDateTime } = require('../../utils/time');
const { AUDIENCES } = require('../../constants/catalog');
const appointmentRepository = require('../../repositories/appointmentRepository');
const admissionItemRepository = require('../../repositories/admissionItemRepository');
const auditRepository = require('../../repositories/auditRepository');
const checklistService = require('./checklistService');
const appointmentCode = require('./appointmentCode');
const slotPlanner = require('./slotPlanner');

const CODE_MAX_ATTEMPTS = 5;
const TRANSITIONS = { BOOKED: ['CHECKED_IN', 'CANCELLED', 'NO_SHOW'], CHECKED_IN: ['COMPLETED'], COMPLETED: [], CANCELLED: [], NO_SHOW: [] };
const EVENT = { CANCELLED: 'APPOINTMENT_CANCELLED', CHECKED_IN: 'APPOINTMENT_CHECKED_IN', COMPLETED: 'APPOINTMENT_COMPLETED', NO_SHOW: 'APPOINTMENT_NO_SHOW' };

const maskName = (n) => (n ? n.trim().split(/\s+/).map((w, i, a) => (i === a.length - 1 ? w : `${w[0]}.`)).join(' ') : null);

function createAppointmentService({ db, configService, broadcast }) {
  const cfg = () => ({
    timeSlots: configService.get('OFFICE_TIME_SLOTS'),
    workingDays: configService.get('OFFICE_WORKING_DAYS'),
    slotMinutes: configService.get('APPOINTMENT_SLOT_MINUTES'),
    capacity: configService.get('APPOINTMENT_CAPACITY_PER_SLOT'),
  });
  const assertEnabled = () => {
    if (!configService.get('APPOINTMENT_ENABLED')) throw new HttpError(403, 'Chức năng đặt lịch nộp hồ sơ đang tạm dừng');
  };
  const parseCode = (raw) => {
    const code = appointmentCode.normalize(raw);
    if (!code) throw new HttpError(404, 'Mã hẹn không hợp lệ');
    return code;
  };
  const minStart = (now = new Date()) => new Date(now.getTime() + configService.get('APPOINTMENT_MIN_LEAD_HOURS') * 3_600_000);

  async function generateSlots(now = new Date()) {
    const today = vnToday(now);
    const days = configService.get('APPOINTMENT_DAYS_AHEAD');
    const holidays = new Set((await appointmentRepository.listHolidays(db, today, addDays(today, days))).map((h) => h.day));
    let created = 0;
    for (let i = 0; i <= days; i += 1) {
      for (const s of slotPlanner.plan(addDays(today, i), cfg(), holidays)) created += await appointmentRepository.insertSlot(db, s);
    }
    return { created };
  }

  async function availableSlots({ from, to } = {}, now = new Date()) {
    assertEnabled();
    const today = vnToday(now);
    const last = addDays(today, configService.get('APPOINTMENT_DAYS_AHEAD'));
    const f = from && from > today ? from : today;
    const t = to && to < last ? to : last;
    const slots = await appointmentRepository.listOpenSlots(db, { from: f, to: t, minStartUtc: minStart(now).toISOString() });
    const days = new Map();
    for (const s of slots) {
      if (!days.has(s.slot_date)) days.set(s.slot_date, { date: s.slot_date, remaining: 0, slots: [] });
      const d = days.get(s.slot_date);
      d.slots.push(s);
      d.remaining += s.remaining;
    }
    return { from: f, to: t, days: [...days.values()] };
  }

  async function evaluateChecklist({ audience, majorCode = null, confirmedDocCodes = [] }) {
    if (!AUDIENCES[audience]) throw new HttpError(400, 'Đối tượng hồ sơ không hợp lệ');
    const items = await admissionItemRepository.list(db, { year: configService.get('CURRENT_ADMISSION_YEAR'), kind: 'DOC_CHECKLIST', audience, majorCode });
    return { items, ...checklistService.evaluate(items, confirmedDocCodes) };
  }

  async function book(input, now = new Date()) {
    assertEnabled();
    const { audience, majorCode = null, slotId, confirmedDocCodes = [], contactName = null, contactPhone = null, contactEmail = null, consent = false, visitorHash } = input;
    const check = await evaluateChecklist({ audience, majorCode, confirmedDocCodes });
    if (configService.get('APPOINTMENT_REQUIRE_COMPLETE') && !check.complete) {
      throw Object.assign(new HttpError(409, 'Bạn cần chuẩn bị đủ giấy tờ bắt buộc trước khi đặt lịch'), { details: check.missingMandatory });
    }
    if ((contactPhone || contactEmail) && consent !== true) {
      throw new HttpError(400, 'Bạn cần đồng ý cho nhà trường dùng thông tin liên hệ để nhắc lịch');
    }
    if (await appointmentRepository.countActive(db, { visitorHash, phone: contactPhone }) >= configService.get('APPOINTMENT_MAX_ACTIVE_PER_VISITOR')) {
      throw new HttpError(409, 'Bạn đang có lịch hẹn chưa diễn ra. Hãy dùng mã hẹn để đổi lịch hoặc hủy lịch cũ trước khi đặt lịch mới.');
    }

    const appt = await db.withTransaction(async (c) => {
      const slot = await appointmentRepository.findSlotForUpdate(c, slotId);
      assertSlotBookable(slot, now);
      await appointmentRepository.adjustBooked(c, slotId, 1);
      let row = null;
      for (let attempt = 0; attempt < CODE_MAX_ATTEMPTS && !row; attempt += 1) {
        // SAVEPOINT: trùng mã (23505) không làm hỏng cả transaction, chỉ thử lại mã khác.
        await c.query('SAVEPOINT appt_code');
        try {
          row = await appointmentRepository.insert(c, {
            id: uuid(), code: appointmentCode.generate(), slotId, audience, majorCode, checklistSnapshot: check.snapshot,
            contactName, contactPhone, contactEmail, consent: Boolean(consent && (contactPhone || contactEmail)), visitorHash,
          });
        } catch (err) {
          await c.query('ROLLBACK TO SAVEPOINT appt_code');
          if (err.code !== '23505' || !/code/.test(err.constraint || err.detail || '')) throw err;
        }
      }
      if (!row) throw new HttpError(503, 'Không tạo được mã hẹn, vui lòng thử lại');
      await appointmentRepository.insertHistory(c, { appointmentId: row.id, fromStatus: null, toStatus: 'BOOKED' });
      return row;
    });
    broadcast('APPOINTMENT_BOOKED', { code: appt.code, slotId: Number(slotId) });
    return view(appt.code, { includeContact: false });
  }

  function assertSlotBookable(slot, now) {
    if (!slot) throw new HttpError(404, 'Không tìm thấy khung giờ');
    if (slot.is_closed) throw new HttpError(409, 'Khung giờ này đã đóng, vui lòng chọn khung khác');
    const date = typeof slot.slot_date === 'string' ? slot.slot_date : slot.slot_date.toISOString().slice(0, 10);
    const start = vnDateTime(date, String(slot.start_time).slice(0, 5));
    if (start < minStart(now)) throw new HttpError(409, 'Khung giờ đã qua hoặc quá sát giờ, vui lòng chọn khung muộn hơn');
    if (date > addDays(vnToday(now), configService.get('APPOINTMENT_DAYS_AHEAD'))) throw new HttpError(409, 'Chưa mở đặt lịch cho ngày này');
    if (slot.booked_count >= slot.capacity) throw new HttpError(409, 'Khung giờ này vừa hết chỗ, vui lòng chọn khung khác');
  }

  async function view(rawCode, { includeContact = false } = {}) {
    const code = parseCode(rawCode);
    const a = await appointmentRepository.findViewByCode(db, code);
    if (!a) throw new HttpError(404, 'Không tìm thấy lịch hẹn với mã này');
    const out = {
      code: a.code, status: a.status, audience: a.audience, audienceLabel: AUDIENCES[a.audience], majorCode: a.major_code, majorName: a.major_name,
      date: a.slot_date, startTime: a.start_time, endTime: a.end_time, slotId: Number(a.slot_id),
      address: configService.get('SUBMISSION_ADDRESS'), checklist: a.checklist_snapshot, rescheduleCount: a.reschedule_count,
      rescheduleLeft: Math.max(0, configService.get('APPOINTMENT_MAX_RESCHEDULE') - a.reschedule_count),
      contactName: maskName(a.contact_name), trackUrl: `/hen.html?code=${a.code}`,
    };
    if (includeContact) Object.assign(out, { contactName: a.contact_name, contactPhone: a.contact_phone, contactEmail: a.contact_email });
    return out;
  }

  /** Khung chung cho chuyển trạng thái. actor = null: thí sinh/hệ thống (không ghi audit). */
  async function transition(rawCode, to, { actor = null, ip = null, note = null, assert } = {}) {
    const code = parseCode(rawCode);
    const appt = await db.withTransaction(async (c) => {
      const a = await appointmentRepository.findByCodeForUpdate(c, code);
      if (!a) throw new HttpError(404, 'Không tìm thấy lịch hẹn với mã này');
      if (!TRANSITIONS[a.status].includes(to)) throw new HttpError(409, `Lịch hẹn đang ở trạng thái ${a.status}, không thể chuyển sang ${to}`);
      if (assert) await assert(c, a);
      const fields = { status: to };
      if (to === 'CANCELLED') fields.cancelled_at = NOW;
      if (to === 'CHECKED_IN') fields.checked_in_at = NOW;
      if (to === 'COMPLETED') fields.completed_at = NOW;
      if (to === 'CANCELLED' || to === 'NO_SHOW') {
        await appointmentRepository.findSlotForUpdate(c, a.slot_id);
        // Hủy thì trả chỗ; vắng mặt (ngày đã qua) không cần trả nhưng giữ số liệu khớp sức chứa.
        if (to === 'CANCELLED') await appointmentRepository.adjustBooked(c, a.slot_id, -1);
      }
      const updated = await appointmentRepository.update(c, a.id, fields);
      await appointmentRepository.insertHistory(c, { appointmentId: a.id, fromStatus: a.status, toStatus: to, actorId: actor?.id ?? null, note });
      if (actor) await auditRepository.insert(c, { actorId: actor.id, action: `APPOINTMENT_${to}`, targetType: 'APPOINTMENT', targetId: a.code, reason: note, ip });
      return updated;
    });
    broadcast(EVENT[to], { code: appt.code });
    return view(appt.code, { includeContact: Boolean(actor) });
  }

  const cancel = (code, opts = {}) => transition(code, 'CANCELLED', opts);
  const complete = (code, opts) => transition(code, 'COMPLETED', opts);
  const checkIn = (code, opts) => transition(code, 'CHECKED_IN', {
    ...opts,
    assert: async (c, a) => {
      const { rows } = await c.query('SELECT slot_date::text AS d FROM appointment_slots WHERE id = ?', [a.slot_id]);
      if (rows[0].d !== vnToday()) throw new HttpError(409, `Lịch hẹn của ngày ${rows[0].d.split('-').reverse().join('/')}, không phải hôm nay`);
    },
  });

  async function reschedule(rawCode, newSlotId, now = new Date()) {
    assertEnabled();
    const code = parseCode(rawCode);
    const appt = await db.withTransaction(async (c) => {
      const a = await appointmentRepository.findByCodeForUpdate(c, code);
      if (!a) throw new HttpError(404, 'Không tìm thấy lịch hẹn với mã này');
      if (a.status !== 'BOOKED') throw new HttpError(409, 'Chỉ đổi được lịch hẹn chưa diễn ra');
      if (Number(a.slot_id) === Number(newSlotId)) throw new HttpError(400, 'Bạn đang chọn đúng khung giờ hiện tại');
      if (a.reschedule_count >= configService.get('APPOINTMENT_MAX_RESCHEDULE')) throw new HttpError(409, 'Bạn đã hết số lần đổi lịch');
      // Khóa 2 slot theo id tăng dần: hai người đổi chéo nhau cùng lúc không bị deadlock.
      const slots = await appointmentRepository.lockSlotsOrdered(c, [Number(a.slot_id), Number(newSlotId)]);
      assertSlotBookable(slots.get(Number(newSlotId)), now);
      await appointmentRepository.adjustBooked(c, a.slot_id, -1);
      await appointmentRepository.adjustBooked(c, newSlotId, 1);
      const updated = await appointmentRepository.update(c, a.id, { slot_id: newSlotId, reschedule_count: a.reschedule_count + 1 });
      await appointmentRepository.insertHistory(c, { appointmentId: a.id, fromStatus: 'BOOKED', toStatus: 'BOOKED', note: `Đổi khung ${a.slot_id} -> ${newSlotId}` });
      return updated;
    });
    broadcast('APPOINTMENT_RESCHEDULED', { code: appt.code });
    return view(appt.code);
  }

  /** Job APPOINTMENT_NO_SHOW: lịch BOOKED của các ngày đã qua -> NO_SHOW (từng lịch một transaction). */
  async function markNoShows(now = new Date()) {
    const ids = await appointmentRepository.listOverdueBookedIds(db, vnToday(now));
    let n = 0;
    for (const id of ids) {
      const { rows } = await db.query('SELECT code FROM appointments WHERE id = ?', [id]);
      try { await transition(rows[0].code, 'NO_SHOW', { note: 'Hệ thống: không đến theo lịch hẹn' }); n += 1; } catch (err) { if (err.status !== 409) throw err; }
    }
    return { noShow: n };
  }

  function ics(a) {
    const toUtc = (d, t) => vnDateTime(d, t).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const esc = (s) => String(s).replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');
    return [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//HHT Tuyen sinh AI//VI', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
      'BEGIN:VEVENT', `UID:${a.code}@hht-tuyensinh`, `DTSTAMP:${toUtc(vnToday(), '00:00')}`,
      `DTSTART:${toUtc(a.date, a.startTime)}`, `DTEND:${toUtc(a.date, a.endTime)}`,
      `SUMMARY:${esc(`Nộp hồ sơ tuyển sinh – mã ${a.code}`)}`,
      `LOCATION:${esc(a.address)}`,
      `DESCRIPTION:${esc(`Mang theo giấy tờ trong checklist. Xuất trình mã hẹn ${a.code} tại bàn tiếp nhận.`)}`,
      'BEGIN:VALARM', 'TRIGGER:-PT2H', 'ACTION:DISPLAY', 'DESCRIPTION:Nhắc lịch nộp hồ sơ', 'END:VALARM',
      'END:VEVENT', 'END:VCALENDAR', '',
    ].join('\r\n');
  }

  // ----- Quản trị -----
  async function adminDay(date) {
    return {
      date,
      slots: await appointmentRepository.listSlotsForAdmin(db, { from: date, to: date }),
      appointments: await appointmentRepository.listByDate(db, date),
    };
  }

  async function adminCalendar({ from, to }) {
    const today = vnToday();
    const f = from || today;
    const t = to || addDays(f, configService.get('APPOINTMENT_DAYS_AHEAD'));
    return { from: f, to: t, slots: await appointmentRepository.listSlotsForAdmin(db, { from: f, to: t }), holidays: await appointmentRepository.listHolidays(db, f, t) };
  }

  async function updateSlot(id, { capacity, isClosed, actor, ip }) {
    const slot = await db.withTransaction(async (c) => {
      const s = await appointmentRepository.findSlotForUpdate(c, id);
      if (!s) throw new HttpError(404, 'Không tìm thấy khung giờ');
      if (capacity !== undefined && capacity < s.booked_count) throw new HttpError(409, `Khung đã có ${s.booked_count} lịch, không thể giảm sức chứa xuống ${capacity}`);
      const u = await appointmentRepository.updateSlot(c, id, { capacity, is_closed: isClosed });
      await auditRepository.insert(c, { actorId: actor.id, action: 'SLOT_UPDATE', targetType: 'APPOINTMENT', targetId: `slot:${id}`, payload: { capacity, isClosed, booked: s.booked_count }, ip });
      return u;
    });
    return { slot, affectedBookings: isClosed ? slot.booked_count : 0 };
  }

  async function setHoliday({ day, reason, remove = false, actor, ip }) {
    const affected = await appointmentRepository.countBookedOnDate(db, day);
    await db.withTransaction(async (c) => {
      if (remove) await appointmentRepository.deleteHoliday(c, day);
      else await appointmentRepository.upsertHoliday(c, day, reason);
      await auditRepository.insert(c, { actorId: actor.id, action: remove ? 'HOLIDAY_REMOVE' : 'HOLIDAY_SET', targetType: 'APPOINTMENT', targetId: `day:${day}`, reason, payload: { affected }, ip });
    });
    return { day, affectedBookings: affected };
  }

  return {
    generateSlots, availableSlots, evaluateChecklist, book, view, cancel, reschedule, checkIn, complete, markNoShows, ics,
    adminDay, adminCalendar, updateSlot, setHoliday, parseCode,
  };
}

module.exports = { createAppointmentService, maskName };
