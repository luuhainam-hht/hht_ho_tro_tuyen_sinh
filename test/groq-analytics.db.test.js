'use strict';
/** Khóa Groq trên trang Cài đặt AI + AI phân tích ở trang Tổng quan (Groq giả, không gọi mạng). */
process.env.TEST_FAKE_LLM = '1';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createTestContext, createStaff } = require('./helpers/testContext');
const { createFakeTransport } = require('./helpers/fakeLlm');

let ctx; let app; const H = {};
const groqCalls = [];
const groqTransport = {
  keys: [],
  async generate(apiKey, req) {
    groqCalls.push({ apiKey, req });
    if (apiKey === 'gsk_saikhoa000000000000000000') { const e = new Error('Groq 401: Invalid API Key'); e.status = 401; throw e; }
    if (/phân tích dữ liệu tư vấn tuyển sinh/.test(req.messages[0].content)) {
      return { text: JSON.stringify({ summary: 'Kỳ này có 2 câu hỏi.', highlights: ['Ngành ô tô được hỏi nhiều'], issues: ['1 câu chưa trả lời được'], actions: [{ title: 'Bổ sung FAQ ký túc xá', detail: 'Thêm câu trả lời', owner: 'Phòng Tuyển sinh' }], faqSuggestions: [{ question: 'Trường có ký túc xá không?', reason: 'Hỏi nhiều' }] }), tokensIn: 300, tokensOut: 120 };
    }
    return { text: JSON.stringify({ answer: 'Trả lời bằng Groq: bạn chuẩn bị hồ sơ theo hướng dẫn của Nhà trường [1].', citations: [1], insufficient: false }), tokensIn: 10, tokensOut: 5 };
  },
};

before(async () => {
  ctx = await createTestContext({ llmTransport: createFakeTransport(), groqTransport });
  app = ctx.app;
  await createStaff(ctx.db, 'quantri', 'SUPER_ADMIN');
  await createStaff(ctx.db, 'phongts', 'ADMISSION_OFFICE');
  await createStaff(ctx.db, 'khoa', 'FACULTY', { faculty: 'Công nghệ thông tin' });
  H.admin = await ctx.login('quantri'); H.office = await ctx.login('phongts'); H.faculty = await ctx.login('khoa');
});
after(() => ctx.close());

test('khóa Groq thêm trên trang Cài đặt AI: tự nhận loại, kiểm tra bằng Groq, lưu mã hóa, trợ lý dùng Groq', async () => {
  const bad = await request(app).post('/api/admin/ai/keys/test').set(H.admin).send({ apiKey: 'gsk_saikhoa000000000000000000' }).expect(200);
  assert.equal(bad.body.ok, false);
  assert.match(bad.body.message, /Khóa Groq sai/);
  const added = await request(app).post('/api/admin/ai/keys').set(H.admin).send({ label: 'Groq phòng TS', apiKey: 'gsk_dungkhoa0000000000000000001' }).expect(201);
  assert.equal(added.body.key.provider, 'GROQ');
  assert.doesNotMatch(JSON.stringify(added.body), /gsk_dungkhoa0000000000000000001/);
  const st = (await request(app).get('/api/admin/ai/status').set(H.admin).expect(200)).body;
  assert.equal(st.providers.groq, true);
  assert.equal(st.providers.groqKeys, 1);
  const { rows } = await ctx.db.query("SELECT key_cipher FROM ai_api_keys WHERE provider = 'GROQ'");
  assert.doesNotMatch(rows[0].key_cipher, /gsk_dungkhoa/, 'khóa lưu dạng mã hóa');

  await ctx.c.configService.update('RAG_MIN_LEXICAL_SCORE', '0.1', { actorId: null, ip: null });
  await ctx.c.configService.update('FAQ_MATCH_SCORE', '0.99', { actorId: null, ip: null });
  await ctx.c.configService.update('FAQ_LEXICAL_MATCH_SCORE', '0.99', { actorId: null, ip: null });
  const s = await request(app).post('/api/chat/sessions').send({}).expect(201);
  const r = (await request(app).post('/api/chat/messages').send({ sessionId: s.body.sessionId, message: 'Bộ đội xuất ngũ nhập học cần giấy tờ gì?' }).expect(200)).body;
  assert.match(r.answer, /Trả lời bằng Groq/);
  assert.ok(groqCalls.some((c) => c.apiKey === 'gsk_dungkhoa0000000000000000001' && c.req.json === true));
});

test('AI phân tích trang Tổng quan: theo quyền xem thống kê, trả nhận định + việc nên làm, lưu tạm 10 phút', async () => {
  await request(app).post('/api/admin/analytics/ai-insights').set(H.faculty).send({}).expect(403);
  // Mặc định phân tích đi Gemini; ở đây chọn Groq trên trang Cài đặt AI.
  await request(app).put('/api/admin/system/configs/AI_PROVIDER_ANALYTICS').set(H.admin).send({ value: 'GROQ' }).expect(200);
  await request(app).put('/api/admin/system/configs/AI_PROVIDER_ANALYTICS').set(H.admin).send({ value: 'OPENAI' }).expect(400);
  const r = (await request(app).post('/api/admin/analytics/ai-insights').set(H.office).send({}).expect(200)).body;
  assert.equal(r.summary, 'Kỳ này có 2 câu hỏi.');
  assert.equal(r.actions[0].owner, 'Phòng Tuyển sinh');
  assert.equal(r.faqSuggestions[0].question, 'Trường có ký túc xá không?');
  assert.equal(r.provider, 'GROQ');
  const sent = groqCalls.at(-1).req.messages.map((m) => m.content).join('\n');
  assert.match(sent, /cauHoiChuaTraLoi/);
  assert.doesNotMatch(sent, /0\d{9}/, 'không gửi số điện thoại');
  const n = groqCalls.length;
  assert.equal((await request(app).post('/api/admin/analytics/ai-insights').set(H.admin).send({}).expect(200)).body.cached, true);
  assert.equal(groqCalls.length, n, 'dùng bản lưu tạm, không gọi lại AI');
  await request(app).post('/api/admin/analytics/ai-insights').set(H.admin).send({ refresh: true }).expect(200);
  assert.equal(groqCalls.length, n + 1);
  const { rows } = await ctx.db.query('SELECT COALESCE(SUM(tokens_in), 0)::int AS t FROM token_usage_daily');
  assert.ok(rows[0].t >= 300, 'token phân tích tính vào ngân sách');
});

test('thống kê AI: ghi từng lượt gọi theo bên/việc, độ trễ, lỗi, khóa, chi phí; chỉ Quản trị xem được', async () => {
  await ctx.c.aiMeter.flush();
  await request(app).get('/api/admin/ai/stats').set(H.office).expect(403);
  const st = (await request(app).get('/api/admin/ai/stats?days=7').set(H.admin).expect(200)).body;
  assert.equal(st.days, 7);
  assert.equal(st.daily.length, 7);
  assert.ok(st.providers.GROQ.calls >= 3, 'chat + phân tích + kiểm tra khóa');
  assert.ok(st.providers.GROQ.errors >= 1, 'lần kiểm tra khóa sai được tính là lỗi');
  const tasks = new Set(st.tasks.filter((t) => t.provider === 'GROQ').map((t) => t.task));
  for (const t of ['CHAT', 'ANALYTICS', 'TEST']) assert.ok(tasks.has(t), `có việc ${t}`);
  assert.ok(st.cost.groqUsd > 0);
  assert.ok(st.cost.totalVnd >= 0);
  const key = st.keys.find((k) => k.label === 'Groq phòng TS');
  assert.ok(key && key.calls >= 2 && key.successes >= 2, 'đếm lượt theo khóa');
  assert.doesNotMatch(JSON.stringify(st), /gsk_dungkhoa/, 'không lộ khóa');
  assert.ok(Array.isArray(st.sources));
  assert.equal(st.routing.analytics, 'GROQ');

  // Ngân sách riêng Groq = 1 token -> chat chuyển sang Gemini (giả)
  await request(app).put('/api/admin/system/configs/GROQ_DAILY_TOKEN_BUDGET').set(H.admin).send({ value: '1' }).expect(200);
  ctx.c.aiMeter.resetCache();
  const n = groqCalls.length;
  const out = await ctx.c.llm.generate({ prompt: 'Chỉ trả JSON', json: true });
  assert.equal(out.provider, 'GEMINI');
  assert.equal(groqCalls.length, n, 'không gọi Groq khi hết ngân sách riêng');
  await request(app).put('/api/admin/system/configs/GROQ_DAILY_TOKEN_BUDGET').set(H.admin).send({ value: '0' }).expect(200);
});
