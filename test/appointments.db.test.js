'use strict';
/** M6 – Đặt lịch hẹn nộp hồ sơ với PostgreSQL thật: chống đặt vượt chỗ, đổi/hủy trả chỗ, check-in, vắng hẹn. */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createTestContext, createStaff } = require('./helpers/testContext');
const { vnToday, addDays } = require('../src/utils/time');

let ctx; let app; let H;
async function insertSlot(date, start, capacity) {
  const end = `${String(Number(start.slice(0, 2)) + 1).padStart(2, '0')}${start.slice(2)}`;
  const { rows } = await ctx.db.query('INSERT INTO appointment_slots (slot_date, start_time, end_time, capacity) VALUES (?, ?, ?, ?) RETURNING id', [date, start, end, capacity]);
  return Number(rows[0].id);
}
const book = (slotId, extra = {}) => request(app).post('/api/appointments').set('User-Agent', `ua-${Math.random()}`).send({ audience: 'CHINH_QUY', slotId, confirmedDocCodes: ['PHIEU_DANG_KY', 'HOC_BA'], ...extra });

before(async () => {
  ctx = await createTestContext();
  app = ctx.app;
  await createStaff(ctx.db, 'tuvan', 'ADVISOR');
  H = await ctx.login('tuvan');
});
after(() => ctx.close());

test('sinh khung giờ theo cấu hình, idempotent', async () => {
  const a = await ctx.c.appointmentService.generateSlots();
  const b = await ctx.c.appointmentService.generateSlots();
  assert.ok(a.created > 0);
  assert.equal(b.created, 0);
  const slots = await request(app).get('/api/appointments/slots').expect(200);
  assert.ok(slots.body.days.length > 0);
});

test('đặt lịch: nhận mã, checklist thiếu được ghi lại, không lộ liên hệ qua kênh công khai', async () => {
  const slot = await insertSlot(addDays(vnToday(), 3), '07:00', 5);
  await book(slot, { contactPhone: '0912345678' }).expect(400); // có liên hệ mà chưa đồng ý
  const r = await book(slot, { contactName: 'Nguyễn Văn An', contactPhone: '0912345678', consent: true }).expect(201);
  assert.match(r.body.code, /^HS-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
  assert.ok(r.body.checklist.missingMandatory.some((m) => m.code === 'CCCD'));
  const v = await request(app).get(`/api/appointments/${r.body.code.toLowerCase().replace(/-/g, '')}`).expect(200);
  assert.equal(v.body.contactPhone, undefined);
  assert.equal(v.body.contactName, 'N. V. An');
  await book(slot, { contactPhone: '0912345678', consent: true }).expect(409); // đã có lịch đang hiệu lực
  const ics = await request(app).get(`/api/appointments/${r.body.code}/ics`).expect(200);
  assert.match(ics.text, /BEGIN:VCALENDAR[\s\S]*DTSTART:\d{8}T000000Z/);
});

test('20 người đặt chỗ cuối cùng cùng lúc: đúng 1 người thành công, không vượt sức chứa', async () => {
  const slot = await insertSlot(addDays(vnToday(), 4), '07:00', 1);
  const results = await Promise.all(Array.from({ length: 20 }, () => book(slot)));
  assert.equal(results.filter((r) => r.status === 201).length, 1);
  assert.ok(results.filter((r) => r.status !== 201).every((r) => r.status === 409));
  const { rows } = await ctx.db.query('SELECT booked_count, capacity FROM appointment_slots WHERE id = ?', [slot]);
  assert.deepEqual(rows[0], { booked_count: 1, capacity: 1 });
});

test('đổi lịch chuyển chỗ; hủy trả chỗ; hết lượt đổi', async () => {
  const s1 = await insertSlot(addDays(vnToday(), 5), '07:00', 3);
  const s2 = await insertSlot(addDays(vnToday(), 5), '18:00', 3);
  const a = (await book(s1).expect(201)).body;
  await request(app).post(`/api/appointments/${a.code}/reschedule`).send({ slotId: s2 }).expect(200);
  let { rows } = await ctx.db.query('SELECT id, booked_count FROM appointment_slots WHERE id IN (?, ?) ORDER BY id', [s1, s2]);
  assert.deepEqual(rows.map((r) => r.booked_count), [0, 1]);
  await request(app).post(`/api/appointments/${a.code}/reschedule`).send({ slotId: s1 }).expect(200);
  await request(app).post(`/api/appointments/${a.code}/reschedule`).send({ slotId: s2 }).expect(409); // tối đa 2 lần
  await request(app).post(`/api/appointments/${a.code}/cancel`).expect(200);
  ({ rows } = await ctx.db.query('SELECT booked_count FROM appointment_slots WHERE id = ?', [s1]));
  assert.equal(rows[0].booked_count, 0);
  await request(app).post(`/api/appointments/${a.code}/cancel`).expect(409);
});

test('check-in sai ngày bị từ chối; đúng ngày -> CHECKED_IN -> COMPLETED; lịch quá hạn -> NO_SHOW', async () => {
  const future = await insertSlot(addDays(vnToday(), 6), '07:00', 3);
  const a = (await book(future).expect(201)).body;
  const wrong = await request(app).post(`/api/admin/appointments/${a.code}/check-in`).set(H).expect(409);
  assert.match(wrong.body.error, /không phải hôm nay/);
  // Dời lịch về hôm nay để thử check-in (cán bộ thao tác trực tiếp DB trong test).
  const todaySlot = await insertSlot(vnToday(), '23:00', 3);
  await ctx.db.query('UPDATE appointments SET slot_id = ? WHERE code = ?', [todaySlot, a.code]);
  await request(app).post(`/api/admin/appointments/${a.code}/check-in`).set(H).expect(200);
  const done = await request(app).post(`/api/admin/appointments/${a.code}/complete`).set(H).expect(200);
  assert.equal(done.body.status, 'COMPLETED');
  const hist = await ctx.db.query('SELECT from_status, to_status FROM appointment_history h JOIN appointments a ON a.id = h.appointment_id WHERE a.code = ? ORDER BY h.id', [a.code]);
  assert.deepEqual(hist.rows.map((r) => r.to_status), ['BOOKED', 'CHECKED_IN', 'COMPLETED']);
  const audits = await ctx.db.query("SELECT COUNT(*)::int AS n FROM audit_logs WHERE target_type = 'APPOINTMENT' AND target_id = ?", [a.code]);
  assert.equal(audits.rows[0].n, 2);

  const old = await insertSlot(addDays(vnToday(), 7), '07:00', 3);
  const b = (await book(old).expect(201)).body;
  await ctx.db.query('UPDATE appointment_slots SET slot_date = ? WHERE id = ?', [addDays(vnToday(), -1), old]);
  const r = await ctx.c.appointmentService.markNoShows();
  assert.equal(r.noShow, 1);
  assert.equal((await request(app).get(`/api/appointments/${b.code}`)).body.status, 'NO_SHOW');
});

test('quản trị: không giảm sức chứa dưới số đã đặt; ngày nghỉ ẩn khung khỏi trang đặt lịch', async () => {
  const day = addDays(vnToday(), 8);
  const s = await insertSlot(day, '07:00', 3);
  await book(s).expect(201);
  await request(app).put(`/api/admin/appointments/slots/${s}`).set(H).send({ capacity: 0 }).expect(409);
  const hol = await request(app).post('/api/admin/appointments/holidays').set(H).send({ day, reason: 'Nghỉ lễ' }).expect(200);
  assert.equal(hol.body.affectedBookings, 1);
  const slots = await request(app).get('/api/appointments/slots').expect(200);
  assert.ok(!slots.body.days.some((d) => d.date === day));
});

test('tra cứu: trả lịch sử trạng thái (không lộ cán bộ); quên mã -> lấy lại bằng SĐT + ngày hẹn', async () => {
  const day = addDays(vnToday(), 9);
  const s1 = await insertSlot(day, '07:00', 3);
  const s2 = await insertSlot(day, '18:00', 3);
  const a = (await book(s1, { contactPhone: '0987 654 321', consent: true }).expect(201)).body;
  assert.deepEqual(a.history.map((h) => h.kind), ['BOOKED']);
  await request(app).post(`/api/appointments/${a.code}/reschedule`).send({ slotId: s2 }).expect(200);
  const v = (await request(app).get(`/api/appointments/${a.code}`).expect(200)).body;
  assert.deepEqual(v.history.map((h) => h.kind), ['BOOKED', 'RESCHEDULED']);
  assert.ok(v.history.every((h) => h.at && h.byStaff === false && h.note === undefined && h.actorId === undefined));

  const ok = await request(app).post('/api/appointments/recover').send({ phone: '+84987654321', date: day }).expect(200);
  assert.deepEqual(ok.body.items.map((i) => [i.code, i.startTime]), [[a.code, '18:00']]);
  assert.equal(ok.body.items[0].contactName, undefined);
  await request(app).post('/api/appointments/recover').send({ phone: '0987654321', date: addDays(day, 1) }).expect(404); // sai ngày
  await request(app).post('/api/appointments/recover').send({ phone: '0987654321' }).expect(400);                      // thiếu ngày
  await request(app).post('/api/appointments/recover').send({ phone: '12345', date: day }).expect(400);                 // SĐT sai dạng
  await request(app).post(`/api/appointments/${a.code}/cancel`).expect(200);
  await request(app).post('/api/appointments/recover').send({ phone: '0987654321', date: day }).expect(404);             // đã hủy thì không trả
});
