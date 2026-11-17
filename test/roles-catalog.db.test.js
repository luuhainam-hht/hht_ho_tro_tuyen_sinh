'use strict';
/**
 * Phân quyền Phòng Tuyển sinh / Cán bộ Khoa và quản lý dữ liệu cẩm nang:
 *  - Cán bộ Khoa chỉ thấy, sửa, thêm ngành của khoa mình.
 *  - Phòng Tuyển sinh quản lý hồ sơ, đợt nhận hồ sơ, liên hệ, giải thích hệ; duyệt FAQ; công bố tài liệu.
 *  - Thay đổi có hiệu lực ngay với trang công khai và trợ lý (tri thức sống, cache tự hết hiệu lực).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createTestContext, createStaff } = require('./helpers/testContext');

let ctx; let app; let H = {};
const CNTT = 'Công nghệ thông tin';

before(async () => {
  ctx = await createTestContext();
  app = ctx.app;
  await createStaff(ctx.db, 'quantri', 'SUPER_ADMIN');
  await createStaff(ctx.db, 'phongts', 'ADMISSION_OFFICE');
  await createStaff(ctx.db, 'khoacntt', 'FACULTY', { faculty: CNTT });
  await createStaff(ctx.db, 'tuvan', 'ADVISOR');
  await createStaff(ctx.db, 'lanhdao', 'LEADER');
  H = { admin: await ctx.login('quantri'), office: await ctx.login('phongts'), faculty: await ctx.login('khoacntt'), advisor: await ctx.login('tuvan'), leader: await ctx.login('lanhdao') };
});
after(() => ctx.close());

async function chat(message) {
  const s = await request(app).post('/api/chat/sessions').send({}).expect(201);
  return (await request(app).post('/api/chat/messages').send({ sessionId: s.body.sessionId, message }).expect(200)).body;
}

test('đăng nhập trả vai trò, khoa và danh sách quyền cho giao diện', async () => {
  const me = (await request(app).get('/api/auth/me').set(H.faculty).expect(200)).body.user;
  assert.equal(me.role, 'FACULTY');
  assert.equal(me.faculty, CNTT);
  assert.ok(me.permissions.includes('MAJOR_MANAGE'));
  assert.ok(!me.permissions.includes('ADMISSION_INFO'));
  const office = (await request(app).get('/api/auth/me').set(H.office).expect(200)).body.user;
  for (const p of ['MAJOR_MANAGE', 'ADMISSION_INFO', 'CONTACT_CONFIG', 'FAQ_APPROVE', 'KB_PUBLISH', 'HANDOFF']) assert.ok(office.permissions.includes(p), p);
  assert.ok(!office.permissions.includes('CONFIG'));
});

test('Cán bộ Khoa: chỉ thấy/sửa/thêm ngành của khoa mình', async () => {
  const list = (await request(app).get('/api/admin/catalog/majors').set(H.faculty).expect(200)).body;
  assert.equal(list.scopeFaculty, CNTT);
  assert.ok(list.majors.length > 0 && list.majors.every((m) => m.faculty === CNTT));
  const own = list.majors[0];
  const other = (await ctx.db.query('SELECT code FROM majors WHERE faculty <> ? LIMIT 1', [CNTT])).rows[0];

  const ok = await request(app).put(`/api/admin/catalog/majors/${own.code}`).set(H.faculty)
    .send({ stateSupport: '50', enterpriseSupport: '20%', tuitionPerMonthMin: 2000000, tuitionPerMonthMax: 2000000 }).expect(200);
  assert.equal(ok.body.major.state_support, '50%', 'chuẩn hóa "50" -> "50%"');
  await request(app).put(`/api/admin/catalog/majors/${other.code}`).set(H.faculty).send({ name: 'Sửa trộm' }).expect(403);
  await request(app).put(`/api/admin/catalog/majors/${own.code}`).set(H.faculty).send({ faculty: 'Khoa khác' }).expect(403);
  await request(app).put(`/api/admin/catalog/majors/${own.code}`).set(H.faculty).send({ stateSupport: '80%', enterpriseSupport: '30%' }).expect(400);

  const created = await request(app).post('/api/admin/catalog/majors').set(H.faculty)
    .send({ code: 'TEST-AI01', name: 'Trí tuệ nhân tạo ứng dụng', faculty: 'Khoa khác', levels: ['CAO_DANG'], tuitionPerMonthMin: 2400000 }).expect(201);
  assert.equal(created.body.major.faculty, CNTT, 'ngành mới luôn thuộc khoa của cán bộ');
  await request(app).post('/api/admin/catalog/majors').set(H.faculty).send({ code: 'TEST-AI01', name: 'Trùng', levels: [] }).expect(409);
  await request(app).put(`/api/admin/catalog/majors/${own.code}`).set(H.leader).send({ name: 'x' }).expect(403);

  // Trang công khai và trợ lý thấy ngay ngành mới
  const pub = (await request(app).get('/api/handbook/majors?q=tri tue nhan tao').expect(200)).body.majors;
  assert.equal(pub[0].code, 'TEST-AI01');
  const r = await chat('Ngành trí tuệ nhân tạo ứng dụng học phí bao nhiêu?');
  assert.equal(r.source, 'RAG');
  assert.match(r.answer, /Trí tuệ nhân tạo ứng dụng/);
  assert.match(r.answer, /2\.400\.000/);
  assert.doesNotMatch(r.answer, /^(Theo văn bản|Hỏi:)/);
  const audit = await ctx.db.query("SELECT action FROM audit_logs WHERE target_type = 'MAJOR' ORDER BY id");
  assert.deepEqual(audit.rows.map((x) => x.action), ['MAJOR_UPDATE', 'MAJOR_CREATE']);
});

test('Phòng Tuyển sinh: thêm đợt nhận hồ sơ -> lịch công khai + trợ lý dùng ngay; Khoa không có quyền', async () => {
  await request(app).get('/api/admin/catalog/admission-items').set(H.faculty).expect(403);
  await request(app).post('/api/admin/catalog/admission-items').set(H.office)
    .send({ kind: 'SCHEDULE', audience: 'CĐ chính quy', title: 'Đợt sai ngày', dateFrom: '2026-12-31', dateTo: '2026-12-01' }).expect(400);
  const created = await request(app).post('/api/admin/catalog/admission-items').set(H.office).send({
    kind: 'SCHEDULE', audience: 'Lớp Kỹ thuật viên AI 2027', title: 'Nhận hồ sơ đợt đặc biệt',
    detail: 'Nhận hồ sơ lớp kỹ thuật viên AI từ 01/01/2026 đến 31/12/2030', dateFrom: '2026-01-01', dateTo: '2030-12-31',
  }).expect(201);
  assert.match(created.body.item.item_key, /^ADMIN:/);

  const sched = (await request(app).get('/api/handbook/schedule').expect(200)).body.items;
  const mine = sched.find((s) => s.id === created.body.item.id);
  assert.equal(mine.status, 'ONGOING');
  const r = await chat('Lớp kỹ thuật viên AI nhận hồ sơ khi nào?');
  assert.equal(r.source, 'RAG');
  assert.match(r.answer, /2030/);

  await request(app).put(`/api/admin/catalog/admission-items/${created.body.item.id}`).set(H.office).send({ isActive: false }).expect(200);
  assert.ok(!(await request(app).get('/api/handbook/schedule')).body.items.some((s) => s.id === created.body.item.id));
  await request(app).delete(`/api/admin/catalog/admission-items/${created.body.item.id}`).set(H.office).expect(200);
  await request(app).delete(`/api/admin/catalog/admission-items/${created.body.item.id}`).set(H.office).expect(404);
});

test('Phòng Tuyển sinh: sửa hồ sơ (trang Hồ sơ) và thông tin liên hệ; không sửa tham số kỹ thuật', async () => {
  const doc = await request(app).post('/api/admin/catalog/admission-items').set(H.office)
    .send({ kind: 'DOC_CHECKLIST', audience: 'CHINH_QUY', title: 'Giấy khám sức khỏe', detail: 'Do bệnh viện cấp huyện trở lên cấp', copyType: 'ORIGINAL', quantity: 1, isMandatory: true }).expect(201);
  const list = (await request(app).get('/api/handbook/checklist?audience=CHINH_QUY').expect(200)).body.items;
  assert.ok(list.some((i) => i.id === doc.body.item.id && i.copyTypeLabel === 'Bản chính'));

  const cfgs = (await request(app).get('/api/admin/catalog/contact-configs').set(H.office).expect(200)).body.configs;
  assert.ok(cfgs.some((c) => c.key === 'HOTLINE'));
  assert.ok(!cfgs.some((c) => c.key === 'ALLOWED_EMBED_ORIGINS'));
  await request(app).put('/api/admin/catalog/contact-configs/HOTLINE').set(H.office).send({ value: '0981 999 888' }).expect(200);
  await request(app).put('/api/admin/catalog/contact-configs/ALLOWED_EMBED_ORIGINS').set(H.office).send({ value: '[]' }).expect(400);
  await request(app).put('/api/admin/system/configs/HOTLINE').set(H.office).send({ value: '1' }).expect(403);
  await request(app).put('/api/admin/catalog/contact-configs/HOTLINE').set(H.faculty).send({ value: '1' }).expect(403);
  assert.equal((await request(app).get('/api/meta')).body.config.HOTLINE, '0981 999 888');
});

test('Phòng Tuyển sinh duyệt FAQ do Khoa soạn', async () => {
  const draft = await request(app).post('/api/admin/faq').set(H.faculty)
    .send({ question: 'Khoa CNTT có phòng máy riêng không?', answer: 'Có, khoa có các phòng máy thực hành riêng cho sinh viên.', topic: 'NGANH' }).expect(201);
  await request(app).post(`/api/admin/faq/${draft.body.faq.id}/approve`).set(H.faculty).expect(403);
  await request(app).post(`/api/admin/faq/${draft.body.faq.id}/approve`).set(H.office).expect(200);
});

test('Quản trị: tạo Cán bộ Khoa bắt buộc chọn khoa; đổi khoa thì phiên cũ hết hiệu lực', async () => {
  await request(app).post('/api/admin/staff').set(H.admin).send({ username: 'khoaoto', fullName: 'Cán bộ ô tô', role: 'FACULTY' }).expect(400);
  const r = await request(app).post('/api/admin/staff').set(H.admin).send({ username: 'khoaoto', fullName: 'Cán bộ ô tô', role: 'FACULTY', faculty: 'Công nghệ ô tô' }).expect(201);
  assert.equal(r.body.user.faculty, 'Công nghệ ô tô');
  const u = await request(app).put(`/api/admin/staff/${r.body.user.id}`).set(H.admin).send({ role: 'ADMISSION_OFFICE' }).expect(200);
  assert.equal(u.body.user.faculty, null, 'vai trò khác không gắn khoa');
  assert.equal(u.body.user.password_hash, undefined, 'không trả mật khẩu băm');
  const facId = (await ctx.db.query("SELECT id FROM staff WHERE username = 'khoacntt'")).rows[0].id;
  await request(app).put(`/api/admin/staff/${facId}`).set(H.admin).send({ faculty: 'Công nghệ ô tô' }).expect(200);
  await request(app).get('/api/auth/me').set(H.faculty).expect(401);
});

test('trang Ngành học: giải thích hệ đào tạo và hỗ trợ học phí cho chatbot', async () => {
  const info = (await request(app).get('/api/handbook/info').expect(200)).body;
  for (const k of ['SO_CAP', 'HE_9_PLUS', 'TRUNG_CAP', 'CAO_DANG']) assert.ok(info.levels[k]?.detail, k);
  for (const k of ['NHA_NUOC', 'DOANH_NGHIEP', 'SINH_VIEN']) assert.ok(info.supports[k]?.detail, k);
  assert.match(info.levels.HE_9_PLUS.detail, /THCS/);
  const item = (await ctx.db.query("SELECT id FROM admission_items WHERE item_key = 'LEVEL:HE_9_PLUS'")).rows[0];
  await request(app).put(`/api/admin/catalog/admission-items/${item.id}`).set(H.office).send({ detail: 'Hệ 9+ (đã cập nhật): học 4 năm, nhận 3 bằng.' }).expect(200);
  assert.match((await request(app).get('/api/handbook/info')).body.levels.HE_9_PLUS.detail, /đã cập nhật/);
});
