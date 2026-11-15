'use strict';
const { updateWhitelisted } = require('../utils/sqlUpdate');

const UPDATABLE = new Set(['slot_id', 'status', 'reschedule_count', 'checked_in_at', 'completed_at', 'cancelled_at']);
const SLOT_UPDATABLE = new Set(['capacity', 'is_closed', 'booked_count']);

const findSlotForUpdate = async (c, id) => (await c.query('SELECT * FROM appointment_slots WHERE id = ? FOR UPDATE', [id])).rows[0] || null;
/** Khóa nhiều slot theo thứ tự id tăng dần -> hai lượt đổi lịch chéo nhau không deadlock. */
async function lockSlotsOrdered(c, ids) {
  const sorted = [...new Set(ids)].sort((a, b) => a - b);
  const out = new Map();
  for (const id of sorted) out.set(id, await findSlotForUpdate(c, id));
  return out;
}
const adjustBooked = (c, slotId, delta) => c.query('UPDATE appointment_slots SET booked_count = booked_count + ? WHERE id = ?', [delta, slotId]);
const updateSlot = (c, id, fields) => updateWhitelisted(c, { table: 'appointment_slots', id, fields, allowed: SLOT_UPDATABLE });

async function insertSlot(c, { date, start, end, capacity }) {
  const res = await c.query(
    `INSERT INTO appointment_slots (slot_date, start_time, end_time, capacity) VALUES (?, ?, ?, ?)
     ON CONFLICT (slot_date, start_time) DO NOTHING`,
    [date, start, end, capacity],
  );
  return res.rowCount;
}

async function listOpenSlots(c, { from, to, minStartUtc }) {
  const { rows } = await c.query(
    `SELECT s.id, s.slot_date::text AS slot_date, to_char(s.start_time, 'HH24:MI') AS start_time, to_char(s.end_time, 'HH24:MI') AS end_time,
            s.capacity, s.booked_count, (s.capacity - s.booked_count) AS remaining
       FROM appointment_slots s
      WHERE s.slot_date BETWEEN ?::date AND ?::date AND NOT s.is_closed
        AND NOT EXISTS (SELECT 1 FROM holidays h WHERE h.day = s.slot_date)
        AND (s.slot_date + s.start_time) AT TIME ZONE 'Asia/Ho_Chi_Minh' >= ?::timestamptz
      ORDER BY s.slot_date, s.start_time`,
    [from, to, minStartUtc],
  );
  return rows;
}

async function listSlotsForAdmin(c, { from, to }) {
  const { rows } = await c.query(
    `SELECT s.id, s.slot_date::text AS slot_date, to_char(s.start_time, 'HH24:MI') AS start_time, to_char(s.end_time, 'HH24:MI') AS end_time,
            s.capacity, s.booked_count, s.is_closed, (h.day IS NOT NULL) AS is_holiday, h.reason AS holiday_reason
       FROM appointment_slots s LEFT JOIN holidays h ON h.day = s.slot_date
      WHERE s.slot_date BETWEEN ?::date AND ?::date ORDER BY s.slot_date, s.start_time`,
    [from, to],
  );
  return rows;
}

async function insert(c, a) {
  const { rows } = await c.query(
    `INSERT INTO appointments (id, code, slot_id, audience, major_code, checklist_snapshot, contact_name, contact_phone, contact_email, consent, visitor_hash)
     VALUES (?, ?, ?, ?, ?, ?::jsonb, ?, ?, ?, ?, ?) RETURNING *`,
    [a.id, a.code, a.slotId, a.audience, a.majorCode ?? null, JSON.stringify(a.checklistSnapshot), a.contactName ?? null,
      a.contactPhone ?? null, a.contactEmail ?? null, a.consent, a.visitorHash ?? null],
  );
  return rows[0];
}

const findByCodeForUpdate = async (c, code) => (await c.query('SELECT * FROM appointments WHERE code = ? FOR UPDATE', [code])).rows[0] || null;

async function findViewByCode(c, code) {
  const { rows } = await c.query(
    `SELECT a.id, a.code, a.status, a.audience, a.major_code, m.name AS major_name, a.checklist_snapshot, a.reschedule_count,
            a.contact_name, a.contact_phone, a.contact_email, a.checked_in_at, a.completed_at, a.cancelled_at, a.created_at,
            s.id AS slot_id, s.slot_date::text AS slot_date, to_char(s.start_time, 'HH24:MI') AS start_time, to_char(s.end_time, 'HH24:MI') AS end_time
       FROM appointments a JOIN appointment_slots s ON s.id = a.slot_id LEFT JOIN majors m ON m.code = a.major_code
      WHERE a.code = ?`,
    [code],
  );
  return rows[0] || null;
}

const update = (c, id, fields) => updateWhitelisted(c, { table: 'appointments', id, fields, allowed: UPDATABLE });

async function countActive(c, { visitorHash, phone }) {
  const { rows } = await c.query(
    `SELECT COUNT(*)::int AS n FROM appointments a JOIN appointment_slots s ON s.id = a.slot_id
      WHERE a.status = 'BOOKED' AND s.slot_date >= (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
        AND ((?::text IS NOT NULL AND a.visitor_hash = ?) OR (?::text IS NOT NULL AND a.contact_phone = ?))`,
    [visitorHash, visitorHash, phone, phone],
  );
  return rows[0].n;
}

async function listByDate(c, date) {
  const { rows } = await c.query(
    `SELECT a.id, a.code, a.status, a.audience, a.major_code, m.name AS major_name, a.contact_name, a.contact_phone, a.contact_email,
            a.checklist_snapshot, a.checked_in_at, a.completed_at, to_char(s.start_time, 'HH24:MI') AS start_time, to_char(s.end_time, 'HH24:MI') AS end_time
       FROM appointments a JOIN appointment_slots s ON s.id = a.slot_id LEFT JOIN majors m ON m.code = a.major_code
      WHERE s.slot_date = ?::date ORDER BY s.start_time, a.created_at`,
    [date],
  );
  return rows;
}

/** Lịch BOOKED của các ngày đã qua -> NO_SHOW (job cuối ngày). */
const listOverdueBookedIds = async (c, today) => (await c.query(
  `SELECT a.id FROM appointments a JOIN appointment_slots s ON s.id = a.slot_id WHERE a.status = 'BOOKED' AND s.slot_date < ?::date`, [today],
)).rows.map((r) => r.id);

async function insertHistory(c, { appointmentId, fromStatus, toStatus, actorId = null, note = null }) {
  await c.query(
    'INSERT INTO appointment_history (appointment_id, from_status, to_status, actor_id, note) VALUES (?, ?, ?, ?, ?)',
    [appointmentId, fromStatus, toStatus, actorId, note],
  );
}

const listHolidays = async (c, from, to) => (await c.query('SELECT day::text AS day, reason FROM holidays WHERE day BETWEEN ?::date AND ?::date ORDER BY day', [from, to])).rows;
const upsertHoliday = (c, day, reason) => c.query('INSERT INTO holidays (day, reason) VALUES (?, ?) ON CONFLICT (day) DO UPDATE SET reason = EXCLUDED.reason', [day, reason]);
const deleteHoliday = (c, day) => c.query('DELETE FROM holidays WHERE day = ?', [day]);
const countBookedOnDate = async (c, day) => (await c.query(
  "SELECT COUNT(*)::int AS n FROM appointments a JOIN appointment_slots s ON s.id = a.slot_id WHERE s.slot_date = ?::date AND a.status = 'BOOKED'", [day],
)).rows[0].n;

module.exports = {
  findSlotForUpdate, lockSlotsOrdered, adjustBooked, updateSlot, insertSlot, listOpenSlots, listSlotsForAdmin, insert,
  findByCodeForUpdate, findViewByCode, update, countActive, listByDate, listOverdueBookedIds, insertHistory,
  listHolidays, upsertHoliday, deleteHoliday, countBookedOnDate,
};
