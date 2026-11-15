'use strict';
/** Tích hợp với PostgreSQL thật: hỏi đáp, kho tri thức, FAQ, chuyển cán bộ, phân quyền, bảo mật, thống kê. */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const WebSocket = require('ws');
const { createTestContext, createStaff, PASSWORD } = require('./helpers/testContext');

let ctx; let app; let H = {};
before(async () => {
  ctx = await createTestContext();
  app = ctx.app;
  await createStaff(ctx.db, 'quantri', 'SUPER_ADMIN');
  await createStaff(ctx.db, 'lanhdao', 'LEADER');
  await createStaff(ctx.db, 'tuvan', 'ADVISOR');
  await createStaff(ctx.db, 'canbomoi', 'ADVISOR', { mustChange: true });
  H = { admin: await ctx.login('quantri'), leader: await ctx.login('lanhdao'), advisor: await ctx.login('tuvan') };
});
after(() => ctx.close());

async function chat(message, extra = {}) {
  const s = await request(app).post('/api/chat/sessions').send({}).expect(201);
  const r = await request(app).post('/api/chat/messages').send({ sessionId: s.body.sessionId, message, ...extra }).expect(200);
  return { ...r.body, sessionId: s.body.sessionId };
}

test('seed: dữ liệu thật từ bộ dữ liệu thu thập đã nạp', async () => {
  const counts = (await ctx.db.query(`SELECT
    (SELECT COUNT(*) FROM faq_entries WHERE status='APPROVED')::int AS faq,
    (SELECT COUNT(*) FROM faq_entries WHERE status='DRAFT')::int AS draft,
    (SELECT COUNT(*) FROM majors)::int AS majors,
    (SELECT COUNT(*) FROM kb_chunks)::int AS chunks`)).rows[0];
  assert.equal(counts.faq, 46); assert.equal(counts.draft, 2); assert.equal(counts.majors, 43); assert.ok(counts.chunks > 40);
  const { body } = await request(app).get('/api/handbook/majors?level=HE_9_PLUS').expect(200);
  assert.ok(body.majors.some((m) => m.name === 'Công nghệ ô tô'));
  assert.ok(body.majors.every((m) => m.internal_note === undefined), 'không lộ ghi chú nội bộ');
});

test('trợ lý: luật -> FAQ nguyên văn có nguồn -> trích văn bản -> FALLBACK (không bịa)', async () => {
  assert.equal((await chat('xin chào')).source, 'RULE');
  const faq = await chat('Học phí bao nhiêu vậy ạ?');
  assert.equal(faq.source, 'FAQ');
  assert.match(faq.answer, /1\.800\.000/);
  assert.equal(faq.citations[0].sourceCode, 'S01');
  assert.match(faq.citations[0].url, /^https:\/\/hht\.edu\.vn/);
  const rag = await chat('Bộ đội xuất ngũ cần hồ sơ gì');
  assert.equal(rag.source, 'RAG');
  assert.equal(rag.answerMode, 'EXTRACTIVE');
  assert.match(rag.answer, /Thẻ học nghề/);
  const fb = await chat('Trường có bể bơi không?');
  assert.equal(fb.source, 'FALLBACK');
  assert.equal(fb.handoffSuggested, true);
  assert.match(fb.answer, /0981 670 588/);
});

test('trợ lý: che SĐT trước khi lưu log; đánh giá câu trả lời', async () => {
  const r = await chat('Số điện thoại của em là 0912345678, ngành ô tô học mấy năm?');
  const { rows } = await ctx.db.query("SELECT content FROM chat_messages WHERE session_id = ? AND role = 'USER'", [r.sessionId]);
  assert.doesNotMatch(rows[0].content, /0912345678/);
  await request(app).post(`/api/chat/messages/${r.messageId}/rating`).send({ sessionId: r.sessionId, rating: 1 }).expect(200);
  await request(app).post(`/api/chat/messages/${r.messageId}/rating`).send({ sessionId: '00000000-0000-4000-8000-000000000000', rating: 1 }).expect(404);
});

test('chuyển cán bộ: cần đồng ý -> NEW -> trả lời -> đưa vào FAQ (DRAFT) -> Lãnh đạo duyệt -> trợ lý dùng ngay', async () => {
  const fb = await chat('Trường có bể bơi không?');
  await request(app).post('/api/chat/handoff').send({ sessionId: fb.sessionId, question: 'Trường có bể bơi không?', contactPhone: '0912345678', consent: false }).expect(400);
  const h = await request(app).post('/api/chat/handoff').send({ sessionId: fb.sessionId, question: 'Trường có bể bơi không?', contactName: 'An', contactPhone: '0912345678', consent: true }).expect(201);
  await request(app).post(`/api/admin/handoffs/${h.body.id}/answer`).set(H.leader).send({ answer: 'x' }).expect(403);
  await request(app).post(`/api/admin/handoffs/${h.body.id}/answer`).set(H.advisor)
    .send({ answer: 'Hiện trường chưa có bể bơi; sinh viên dùng khu liên hợp thể thao (bóng đá, cầu lông, pickleball).' }).expect(200);
  const promoted = await request(app).post(`/api/admin/handoffs/${h.body.id}/promote`).set(H.advisor).expect(200);
  assert.equal(promoted.body.faq.status, 'DRAFT');
  assert.equal((await chat('Trường có bể bơi không?')).source, 'FALLBACK', 'FAQ nháp chưa được dùng');
  await request(app).post(`/api/admin/faq/${promoted.body.faq.id}/approve`).set(H.advisor).expect(403);
  await request(app).post(`/api/admin/faq/${promoted.body.faq.id}/approve`).set(H.leader).expect(200);
  const after = await chat('Trường có bể bơi không?');
  assert.equal(after.source, 'FAQ');
  assert.match(after.answer, /chưa có bể bơi/);
});

test('kho tri thức: tải văn bản -> job xử lý -> READY -> chỉ Lãnh đạo công bố -> trợ lý trích dẫn', async () => {
  const text = '# Thông báo lệ phí xét tuyển 2027\nLệ phí xét tuyển hệ cao đẳng là 50.000 đồng mỗi hồ sơ, nộp khi đăng ký.\nThí sinh nộp lệ phí tại phòng tài chính kế toán.';
  const up = await request(app).post('/api/admin/kb').set(H.advisor).field('title', 'Thông báo lệ phí xét tuyển').attach('file', Buffer.from(text), 'le-phi.txt').expect(201);
  await request(app).post('/api/admin/kb').set(H.advisor).field('title', 'Trùng').attach('file', Buffer.from(text), 'le-phi-2.txt').expect(409);
  await ctx.c.jobRunner.runOnce();
  const id = up.body.document.id;
  const doc = await request(app).get(`/api/admin/kb/${id}`).set(H.leader).expect(200);
  assert.equal(doc.body.document.status, 'READY');
  assert.ok(doc.body.chunks.length >= 1);
  assert.equal((await chat('Lệ phí xét tuyển bao nhiêu tiền?')).source, 'FALLBACK', 'chưa công bố thì chưa dùng');
  await request(app).post(`/api/admin/kb/${id}/publish`).set(H.advisor).expect(403);
  await request(app).post(`/api/admin/kb/${id}/publish`).set(H.leader).expect(200);
  const r = await chat('Lệ phí xét tuyển bao nhiêu tiền?');
  assert.equal(r.source, 'RAG');
  assert.match(r.answer, /50\.000/);
  assert.equal(r.citations[0].title, 'Thông báo lệ phí xét tuyển');
  const { rows } = await ctx.db.query("SELECT action FROM audit_logs WHERE target_type = 'KB_DOCUMENT' ORDER BY id");
  assert.deepEqual(rows.map((x) => x.action), ['KB_UPLOAD', 'KB_PUBLISHED']);
});

test('xác thực: khóa sau 5 lần sai; bắt đổi mật khẩu; mật khẩu yếu bị từ chối', async () => {
  for (let i = 0; i < 4; i += 1) await request(app).post('/api/auth/login').send({ username: 'canbomoi', password: 'sai' }).expect(401);
  await request(app).post('/api/auth/login').send({ username: 'canbomoi', password: 'sai' }).expect(423);
  await request(app).post('/api/auth/login').send({ username: 'canbomoi', password: PASSWORD }).expect(423);
  await ctx.db.query("UPDATE staff SET locked_until = NULL WHERE username = 'canbomoi'");
  const login = await request(app).post('/api/auth/login').send({ username: 'canbomoi', password: PASSWORD }).expect(200);
  const auth = { Authorization: `Bearer ${login.body.token}` };
  const blocked = await request(app).get('/api/admin/analytics/summary').set(auth).expect(403);
  assert.equal(blocked.body.code, 'MUST_CHANGE_PASSWORD');
  await request(app).post('/api/auth/change-password').set(auth).send({ currentPassword: PASSWORD, newPassword: 'ngan' }).expect(400);
  await request(app).post('/api/auth/change-password').set(auth).send({ currentPassword: PASSWORD, newPassword: 'MatKhauMoi2027' }).expect(200);
  await request(app).get('/api/admin/analytics/summary').set(auth).expect(200);
});

test('cấu hình: kiểm tra biên, ghi audit, đổi ngay; chỉ SUPER_ADMIN', async () => {
  await request(app).put('/api/admin/system/configs/RAG_TOP_K').set(H.leader).send({ value: '3' }).expect(403);
  await request(app).put('/api/admin/system/configs/RAG_TOP_K').set(H.admin).send({ value: '50' }).expect(400);
  await request(app).put('/api/admin/system/configs/HOTLINE').set(H.admin).send({ value: '0981 667 288' }).expect(200);
  assert.equal((await request(app).get('/api/meta')).body.config.HOTLINE, '0981 667 288');
  assert.match((await chat('Trường có bể bơi ở cơ sở 3 không?')).answer, /0981 667 288/);
});

test('bảo mật: CSP không inline, origin lạ bị chặn, widget nhúng theo cấu hình, 404 JSON/HTML', async () => {
  const home = await request(app).get('/').expect(200);
  assert.match(home.headers['content-security-policy'], /script-src 'self'/);
  assert.doesNotMatch(home.headers['content-security-policy'], /unsafe-inline/);
  assert.match(home.headers['content-security-policy'], /frame-ancestors 'self'(;|$)/);
  const chatPage = await request(app).get('/chat.html').expect(200);
  assert.match(chatPage.headers['content-security-policy'], /frame-ancestors 'self' https:\/\/hht\.edu\.vn/);
  await request(app).post('/api/chat/sessions').set('Origin', 'https://evil.example').send({}).expect(403);
  assert.equal((await request(app).get('/api/khong-co').expect(404)).body.error, 'Không tìm thấy tài nguyên');
  await request(app).get('/trang-khong-co').expect(404).expect('Content-Type', /html/);
  await request(app).get('/api/admin/faq').expect(401);
});

test('realtime: socket chưa xác thực không nhận câu hỏi; cán bộ nhận QUESTION_LOGGED', async () => {
  const url = `ws://127.0.0.1:${ctx.port}/ws`;
  const anon = new WebSocket(url);
  const staff = new WebSocket(url);
  const got = { anon: [], staff: [] };
  anon.on('message', (m) => got.anon.push(JSON.parse(m).type));
  staff.on('message', (m) => got.staff.push(JSON.parse(m).type));
  await Promise.all([new Promise((r) => anon.on('open', r)), new Promise((r) => staff.on('open', r))]);
  staff.send(JSON.stringify({ type: 'AUTH', token: H.advisor.Authorization.slice(7) }));
  await new Promise((r) => setTimeout(r, 150));
  await chat('Học phí bao nhiêu?');
  await new Promise((r) => setTimeout(r, 150));
  assert.ok(got.staff.includes('QUESTION_LOGGED'));
  assert.ok(!got.anon.includes('QUESTION_LOGGED'));
  anon.close(); staff.close();
});

test('gợi ý ngành: chấm điểm, lưu phiên, kiểm tra input', async () => {
  const q = (await request(app).get('/api/recommend/questionnaire').expect(200)).body;
  assert.equal(q.riasecItems.length, 18);
  const riasec = Object.fromEntries(q.riasecItems.map((i) => [i.id, ['R', 'I'].includes(i.type) ? 5 : 2]));
  await request(app).post('/api/recommend').send({ answers: { education: 'THPT', riasec: { r1: 9 } } }).expect(400);
  const r = await request(app).post('/api/recommend').send({ answers: { education: 'THPT', riasec, subjects: { VAT_LY: 5, TOAN: 4 }, preferences: { workStyle: 'WORKSHOP' } } }).expect(200);
  assert.equal(r.body.results.length, 3);
  assert.ok(r.body.results.every((x) => x.levels.every((l) => ['CAO_DANG', 'TRUNG_CAP', 'SO_CAP'].includes(l))));
  assert.match(r.body.results[0].faculty, /Cơ khí|Điện|ô tô/);
  await request(app).get(`/api/recommend/${r.body.id}`).expect(200);
});

test('thống kê: tổng hợp, câu chưa trả lời, xuất Excel', async () => {
  const s = await request(app).get('/api/admin/analytics/summary').set(H.leader).expect(200);
  assert.ok(s.body.questions >= 8);
  assert.ok(s.body.sourceShare.some((x) => x.source === 'FAQ'));
  const u = await request(app).get('/api/admin/analytics/unanswered').set(H.leader).expect(200);
  assert.ok(u.body.clusters[0].count >= 2);
  const x = await request(app).get('/api/admin/analytics/export.xlsx').set(H.admin).buffer(true).parse((res, cb) => { const d = []; res.on('data', (c) => d.push(c)); res.on('end', () => cb(null, Buffer.concat(d))); }).expect(200);
  assert.equal(x.body.subarray(0, 2).toString(), 'PK');
});

test('Messenger: tắt mặc định; chữ ký sai bị từ chối', async () => {
  await request(app).get('/api/messenger/webhook?hub.mode=subscribe&hub.verify_token=test-verify&hub.challenge=42').expect(403);
  await request(app).post('/api/messenger/webhook').set('X-Hub-Signature-256', 'sha256=sai').send({ object: 'page' }).expect(403);
});
