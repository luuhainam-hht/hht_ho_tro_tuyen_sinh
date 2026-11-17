'use strict';
/**
 * Cài đặt AI và quản lý mật khẩu trên trang quản trị (PostgreSQL thật + LLM giả):
 * khóa API mã hóa, nạp lại không khởi động lại, bật/tắt AI, mô hình dự phòng, thử câu hỏi,
 * lời nhắc tùy biến, đặt mật khẩu / mở khóa / đăng xuất mọi phiên, chính sách mật khẩu theo cấu hình.
 */
process.env.TEST_FAKE_LLM = '1';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createTestContext, createStaff, PASSWORD } = require('./helpers/testContext');
const { createFakeTransport } = require('./helpers/fakeLlm');

const NEW_KEY = 'AIzaFakeAdminKey0000000000000000001';
let ctx; let app; let H = {};
const transport = createFakeTransport({
  responder: (req) => {
    if (req.model === 'mo-hinh-hong') throw Object.assign(new Error('models/mo-hinh-hong is not found'), { status: 404 });
    if (/kiểm tra kết nối/.test(req.system)) return 'OK';
    return { answer: 'Hồ sơ của bộ đội xuất ngũ cần Thẻ học nghề bản gốc [1].', citations: [1], intent: 'HO_SO', topics: ['HO_SO'], major_codes: [], insufficient: false };
  },
  failKeys: new Set(['fake-key-1']),
});

before(async () => {
  ctx = await createTestContext({ llmTransport: transport });
  app = ctx.app;
  await ctx.c.ingestService.reembedMissing();
  await createStaff(ctx.db, 'quantri', 'SUPER_ADMIN');
  await createStaff(ctx.db, 'lanhdao', 'LEADER');
  await createStaff(ctx.db, 'tuvan', 'ADVISOR');
  H = { admin: await ctx.login('quantri'), leader: await ctx.login('lanhdao') };
});
after(() => ctx.close());

const setConfig = (key, value) => request(app).put(`/api/admin/system/configs/${key}`).set(H.admin).send({ value });

test('khóa API: chỉ Quản trị viên; lưu mã hóa, API không trả khóa thật; nạp vào trợ lý ngay', async () => {
  await request(app).get('/api/admin/ai/status').set(H.leader).expect(403);
  await request(app).post('/api/admin/ai/keys').set(H.admin).send({ label: 'Khóa phòng CNTT', apiKey: 'ngan' }).expect(400);
  const before = ctx.c.llm.keyCount();
  const added = await request(app).post('/api/admin/ai/keys').set(H.admin).send({ label: 'Khóa phòng CNTT', apiKey: NEW_KEY }).expect(201);
  assert.equal(added.body.key.key_hint, 'AIza…0001');
  assert.equal(JSON.stringify(added.body).includes(NEW_KEY), false);
  assert.equal(ctx.c.llm.keyCount(), before + 1);
  await request(app).post('/api/admin/ai/keys').set(H.admin).send({ label: 'Trùng', apiKey: NEW_KEY }).expect(409);

  const { rows } = await ctx.db.query('SELECT key_cipher FROM ai_api_keys');
  assert.equal(rows[0].key_cipher.includes(NEW_KEY), false);
  assert.match(rows[0].key_cipher, /^v1:/);

  const status = await request(app).get('/api/admin/ai/status').set(H.admin).expect(200);
  assert.equal(status.body.keys.length, 1);
  assert.equal(status.body.envKeys.length, 2);
  assert.equal(JSON.stringify(status.body).includes(NEW_KEY), false);

  const tested = await request(app).post(`/api/admin/ai/keys/${added.body.key.id}/test`).set(H.admin).expect(200);
  assert.equal(tested.body.ok, true);
  const conn = await request(app).post('/api/admin/ai/test-connection').set(H.admin).expect(200);
  assert.deepEqual(conn.body.results.map((r) => r.ok), [false, true, true]); // fake-key-1 hết hạn mức

  await request(app).put(`/api/admin/ai/keys/${added.body.key.id}`).set(H.admin).send({ isActive: false }).expect(200);
  assert.equal(ctx.c.llm.keyCount(), before);
  await request(app).delete(`/api/admin/ai/keys/${added.body.key.id}`).set(H.admin).expect(200);
  assert.equal((await ctx.db.query('SELECT COUNT(*)::int AS n FROM ai_api_keys')).rows[0].n, 0);
  const audit = await ctx.db.query("SELECT action FROM audit_logs WHERE target_type = 'AI_KEY' ORDER BY id");
  assert.deepEqual(audit.rows.map((a) => a.action), ['AI_KEY_ADD', 'AI_KEY_UPDATE', 'AI_KEY_DELETE']);
});

test('thử câu hỏi: chạy đủ quy trình, có chi tiết từng bước, không ghi log hội thoại', async () => {
  const msgsBefore = (await ctx.db.query('SELECT COUNT(*)::int AS n FROM chat_messages')).rows[0].n;
  const r = await request(app).post('/api/admin/ai/try').set(H.admin).send({ message: 'Bộ đội xuất ngũ cần chuẩn bị giấy tờ gì để nhập học?' }).expect(200);
  assert.equal(r.body.source, 'RAG');
  assert.equal(r.body.answerMode, 'LLM');
  assert.equal(r.body.trace.llm.used, true);
  assert.ok(r.body.trace.retrieval.chunks.length >= 1);
  assert.equal((await ctx.db.query('SELECT COUNT(*)::int AS n FROM chat_messages')).rows[0].n, msgsBefore);
});

test('tắt AI: không gọi mô hình nhưng vẫn trả lời; bật lại dùng tiếp', async () => {
  await setConfig('AI_ENABLED', 'false').expect(200);
  const calls = transport.calls.generate;
  const r = await request(app).post('/api/admin/ai/try').set(H.admin).send({ message: 'Bộ đội xuất ngũ cần chuẩn bị giấy tờ gì để nhập học?' }).expect(200);
  assert.equal(transport.calls.generate, calls);
  assert.notEqual(r.body.answerMode, 'LLM');
  assert.equal(r.body.trace.llm.enabled, false);
  await setConfig('AI_ENABLED', 'true').expect(200);
});

test('mô hình chính lỗi -> tự dùng mô hình dự phòng', async () => {
  await setConfig('LLM_MODEL', 'mo-hinh-hong').expect(200);
  await setConfig('LLM_FALLBACK_MODEL', 'gemini-2.5-flash-lite').expect(200);
  const r = await request(app).post('/api/admin/ai/try').set(H.admin).send({ message: 'Bộ đội xuất ngũ cần chuẩn bị giấy tờ gì để nhập học?' }).expect(200);
  assert.equal(r.body.answerMode, 'LLM');
  assert.equal(r.body.trace.llm.model, 'gemini-2.5-flash-lite');
  assert.equal(r.body.trace.llm.fallbackUsed, true);
  // Lỗi sai tên mô hình không được làm khóa bị "nghỉ" oan.
  assert.ok(ctx.c.llm.keyStatus().filter((k) => k.lastError === 'BAD_REQUEST').length === 0);
  await setConfig('LLM_MODEL', 'gemini-2.5-flash').expect(200);
  await setConfig('LLM_FALLBACK_MODEL', '').expect(200);
});

test('lời nhắc: giọng văn, số từ, hướng dẫn bổ sung; giá trị sai bị từ chối', async () => {
  await setConfig('AI_TONE', 'VUI_NHON').expect(400);
  await setConfig('HOTLINE', '').expect(400);
  await setConfig('AI_TONE', 'TRANG_TRONG').expect(200);
  await setConfig('AI_ANSWER_MAX_WORDS', '90').expect(200);
  await setConfig('AI_EXTRA_INSTRUCTIONS', 'Luôn nhắc thí sinh mang CCCD khi đến trường.').expect(200);
  const p = (await request(app).get('/api/admin/ai/prompt-preview').set(H.admin).expect(200)).body.prompt;
  assert.match(p, /tối đa khoảng 90 từ/);
  assert.match(p, /Nhà trường/);
  assert.match(p, /mang CCCD/);
  assert.ok(p.indexOf('QUY TẮC BẮT BUỘC') < p.indexOf('HƯỚNG DẪN BỔ SUNG'));
  const cleared = await request(app).post('/api/admin/ai/cache/clear').set(H.admin).expect(200);
  assert.equal(typeof cleared.body.removed, 'number');
});

test('đặt mật khẩu cho cán bộ: đăng nhập được bằng mật khẩu mới, phiên cũ bị đăng xuất', async () => {
  const { rows } = await ctx.db.query("SELECT id FROM staff WHERE username = 'tuvan'");
  const id = rows[0].id;
  const old = await ctx.login('tuvan');
  await request(app).post(`/api/admin/staff/${id}/set-password`).set(H.leader).send({ newPassword: 'TuVanVien2026' }).expect(403);
  await request(app).post(`/api/admin/staff/${id}/set-password`).set(H.admin).send({ newPassword: 'ngan1' }).expect(400);
  await request(app).post(`/api/admin/staff/${id}/set-password`).set(H.admin).send({ newPassword: 'tuvan2026abc' }).expect(400); // chứa tên đăng nhập
  await request(app).post(`/api/admin/staff/${id}/set-password`).set(H.admin).send({ newPassword: 'TuyenSinh2026hht', requireChange: false }).expect(200);
  await request(app).get('/api/auth/me').set(old).expect(401);
  await request(app).post('/api/auth/login').send({ username: 'tuvan', password: PASSWORD }).expect(401);
  const ok = await request(app).post('/api/auth/login').send({ username: 'tuvan', password: 'TuyenSinh2026hht' }).expect(200);
  assert.equal(ok.body.user.mustChangePassword, false);
  const me = await request(app).get('/api/admin/staff').set(H.admin).expect(200);
  const u = me.body.items.find((x) => x.username === 'tuvan');
  assert.ok(u.last_login_at && u.password_changed_at);

  const self = (await ctx.db.query("SELECT id FROM staff WHERE username = 'quantri'")).rows[0].id;
  await request(app).post(`/api/admin/staff/${self}/set-password`).set(H.admin).send({ newPassword: 'QuanTri2026abc' }).expect(400);
});

test('mở khóa đăng nhập, đăng xuất mọi phiên, tạo tài khoản với mật khẩu tự đặt', async () => {
  const id = (await ctx.db.query("SELECT id FROM staff WHERE username = 'lanhdao'")).rows[0].id;
  for (let i = 0; i < 5; i += 1) await request(app).post('/api/auth/login').send({ username: 'lanhdao', password: 'sai-mat-khau' });
  await request(app).post('/api/auth/login').send({ username: 'lanhdao', password: PASSWORD }).expect(423);
  await request(app).post(`/api/admin/staff/${id}/unlock`).set(H.admin).expect(200);
  const s = await ctx.login('lanhdao');
  const out = await request(app).post(`/api/admin/staff/${id}/logout-all`).set(H.admin).expect(200);
  assert.ok(out.body.sessions >= 1);
  await request(app).get('/api/auth/me').set(s).expect(401);
  H.leader = await ctx.login('lanhdao');

  const created = await request(app).post('/api/admin/staff').set(H.admin)
    .send({ username: 'canbo.moi', fullName: 'Cán bộ mới', role: 'ADVISOR', password: 'HoSoTuyenSinh26', mustChangePassword: false }).expect(201);
  assert.equal(created.body.temporaryPassword, null);
  const login = await request(app).post('/api/auth/login').send({ username: 'canbo.moi', password: 'HoSoTuyenSinh26' }).expect(200);
  assert.equal(login.body.user.mustChangePassword, false);
});

test('chính sách mật khẩu & phiên theo cấu hình: độ dài tối thiểu, số lần sai trước khi khóa', async () => {
  await setConfig('PASSWORD_MIN_LENGTH', '14').expect(200);
  assert.equal((await request(app).get('/api/auth/me').set(H.admin).expect(200)).body.policy.passwordMinLength, 14);
  const id = (await ctx.db.query("SELECT id FROM staff WHERE username = 'canbo.moi'")).rows[0].id;
  await request(app).post(`/api/admin/staff/${id}/set-password`).set(H.admin).send({ newPassword: 'TuyenSinh2026' }).expect(400);
  await request(app).post(`/api/admin/staff/${id}/set-password`).set(H.admin).send({ newPassword: 'TuyenSinh2026hht' }).expect(200);

  await setConfig('LOGIN_MAX_FAILED_ATTEMPTS', '3').expect(200);
  for (let i = 0; i < 2; i += 1) await request(app).post('/api/auth/login').send({ username: 'canbo.moi', password: 'sai' }).expect(401);
  const locked = await request(app).post('/api/auth/login').send({ username: 'canbo.moi', password: 'sai' }).expect(423);
  assert.match(locked.body.error || locked.body.message, /15 phút/);

  await setConfig('SESSION_TTL_HOURS', '2').expect(200);
  const res = await request(app).post('/api/auth/login').send({ username: 'quantri', password: PASSWORD }).expect(200);
  const hours = (new Date(res.body.expiresAt) - Date.now()) / 3_600_000;
  assert.ok(hours > 1.9 && hours <= 2.01);
});

test('xuất Excel tài khoản: danh sách không có mật khẩu; cấp mật khẩu tạm & xuất -> đăng nhập được bằng mật khẩu trong tệp', async () => {
  const ExcelJS = require('exceljs');
  const binary = (res, cb) => { const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => cb(null, Buffer.concat(chunks))); };
  const read = async (buf) => { const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf); return wb.worksheets[0]; };

  await request(app).post('/api/admin/staff/export.xlsx').set(H.leader).send({ mode: 'LIST' }).expect(403);
  const list = await request(app).post('/api/admin/staff/export.xlsx').set(H.admin).send({ mode: 'LIST' }).buffer().parse(binary).expect(200);
  assert.match(list.headers['content-disposition'], /tai-khoan-can-bo/);
  assert.equal(list.headers['cache-control'], 'no-store');
  const ws = await read(list.body);
  const header = ws.getRow(3).values.slice(1);
  assert.ok(header.includes('Tên đăng nhập') && !header.includes('Mật khẩu tạm'));
  const names = []; ws.eachRow((r, i) => { if (i > 3) names.push(r.getCell(2).value); });
  assert.ok(names.includes('quantri') && names.includes('lanhdao'));
  const text = JSON.stringify(ws.getSheetValues());
  assert.doesNotMatch(text, /\$2[aby]\$/, 'không lộ mã băm mật khẩu');

  await createStaff(ctx.db, 'xuatexcel', 'ADVISOR');
  const target = (await ctx.db.query("SELECT id FROM staff WHERE username = 'xuatexcel'")).rows[0].id;
  const self = (await ctx.db.query("SELECT id FROM staff WHERE username = 'quantri'")).rows[0].id;
  const before = await ctx.login('xuatexcel');
  await request(app).post('/api/admin/staff/export.xlsx').set(H.admin).send({ mode: 'NEW_PASSWORDS', ids: [target] }).expect(400); // thiếu xác nhận
  await request(app).post('/api/admin/staff/export.xlsx').set(H.admin).send({ mode: 'NEW_PASSWORDS', ids: [self], confirm: true }).expect(400); // không tự cấp cho mình
  const out = await request(app).post('/api/admin/staff/export.xlsx').set(H.admin)
    .send({ mode: 'NEW_PASSWORDS', ids: [target, self], confirm: true }).buffer().parse(binary).expect(200);
  const ws2 = await read(out.body);
  assert.equal(ws2.getRow(3).getCell(3).value, 'Mật khẩu tạm');
  assert.equal(ws2.rowCount, 4, 'chỉ tài khoản được chọn, bỏ qua chính mình');
  assert.equal(ws2.getRow(4).getCell(2).value, 'xuatexcel');
  const pw = ws2.getRow(4).getCell(3).value;
  await request(app).get('/api/auth/me').set(before).expect(401); // phiên cũ bị đăng xuất
  const login = await request(app).post('/api/auth/login').send({ username: 'xuatexcel', password: pw }).expect(200);
  assert.equal(login.body.user.mustChangePassword ?? login.body.mustChangePassword, true);
  const audit = await ctx.db.query("SELECT payload FROM audit_logs WHERE action = 'STAFF_EXPORT_PASSWORDS' ORDER BY id DESC LIMIT 1");
  assert.deepEqual(audit.rows[0].payload.ids.map(Number), [Number(target)]);
  assert.doesNotMatch(JSON.stringify(audit.rows[0].payload), new RegExp(pw), 'nhật ký không ghi mật khẩu');
});
