'use strict';
/**
 * Mindtek – nhà cung cấp AI thứ 3, gọi ngầm từ máy chủ (Mindtek giả, không gọi mạng):
 * đọc luồng SSE, chia đều 3 bên, tự chuyển khi lỗi, chat qua khung HHT, thống kê & cấu hình trên trang Cài đặt AI.
 */
process.env.TEST_FAKE_LLM = '1';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createTestContext, createStaff } = require('./helpers/testContext');
const { createFakeTransport } = require('./helpers/fakeLlm');
const { createMindtekClient, createMindtekTransport, parseSse } = require('../src/services/ai/mindtekClient');
const { createLlmClient } = require('../src/services/ai/llmClient');
const { createGroqClient } = require('../src/services/ai/groqClient');

const sse = (text) => ['start', 'start-step'].map((t) => `data: {"type":"${t}"}\n\n`).join('')
  + [...text].map((ch) => `data: ${JSON.stringify({ type: 'text-delta', id: '0', delta: ch })}\n\n`).join('')
  + 'data: {"type":"finish"}\n\ndata: [DONE]\n\n';
const quiet = { warn() {}, info() {}, error() {} };
const cfgOf = (over = {}) => ({ getOr: (k, d) => (k in over ? over[k] : d), get: (k) => over[k] });

test('Mindtek transport: gửi đúng định dạng bot, ghép luồng SSE, báo lỗi HTTP/luồng rỗng', async () => {
  const sent = [];
  const fetchImpl = async (url, init) => {
    sent.push({ url, body: JSON.parse(init.body) });
    if (sent.length === 2) return { ok: false, status: 404, statusText: 'Not Found', text: async () => 'Bot not found' };
    if (sent.length === 3) return { ok: true, status: 200, text: async () => 'data: {"type":"finish"}\n\n' };
    return { ok: true, status: 200, text: async () => sse('Chào bạn [1]') };
  };
  const tr = createMindtekTransport({ fetchImpl });
  const out = await tr.generate({ baseUrl: 'https://mt.example/', botId: 'bot-1', messages: [{ role: 'user', content: 'Xin chào' }] });
  assert.equal(out.text, 'Chào bạn [1]');
  assert.equal(sent[0].url, 'https://mt.example/api/chat/public');
  assert.equal(sent[0].body.botId, 'bot-1');
  assert.deepEqual(sent[0].body.messages[0].parts, [{ type: 'text', text: 'Xin chào' }]);
  await assert.rejects(tr.generate({ baseUrl: 'https://mt.example', botId: 'x', messages: [] }), (e) => e.status === 404);
  await assert.rejects(tr.generate({ baseUrl: 'https://mt.example', botId: 'x', messages: [] }), /không trả nội dung/);
  assert.equal(parseSse('data: {"type":"error","errorText":"hết hạn mức"}\n\n').error, 'hết hạn mức');
});

test('chia đều 3 bên + tự chuyển khi Mindtek lỗi; Mindtek lỗi thì nghỉ một lúc', async () => {
  let t = 0;
  let mtFail = false;
  const mtCalls = [];
  const mindtek = createMindtekClient({
    configService: cfgOf({ MINDTEK_ENABLED: true, MINDTEK_BOT_ID: '1b94a3a9-eae9-4566-a648-ca2265f7e484' }), now: () => t, logger: quiet,
    transport: { async generate(req) { mtCalls.push(req); if (mtFail) throw Object.assign(new Error('Mindtek 503'), { status: 503 }); return { text: '{"answer":"mt"}' }; } },
  });
  const configService = cfgOf();
  const groq = createGroqClient({ apiKeys: ['gsk_x'], configService, logger: quiet, transport: { async generate() { return { text: 'g', tokensIn: 1, tokensOut: 1 }; } } });
  const gem = { async generate() { return { text: 'm', tokensIn: 1, tokensOut: 1 }; }, async embed() { return [[1]]; } };
  const llm = createLlmClient({ apiKeys: ['AIzaX'], configService, transport: gem, logger: quiet, groq, mindtek });
  const seq = [];
  for (let i = 0; i < 6; i += 1) seq.push((await llm.generate({ prompt: 'x', system: 'Quy tắc HHT', json: true })).provider);
  assert.deepEqual(seq, ['GROQ', 'GEMINI', 'MINDTEK', 'GROQ', 'GEMINI', 'MINDTEK'], 'xoay vòng đủ 3 bên');
  // Chỉ dẫn hệ thống của HHT + yêu cầu JSON đi kèm tin nhắn gửi Mindtek.
  assert.match(mtCalls[0].messages.at(-1).content, /Quy tắc HHT[\s\S]*JSON[\s\S]*\[YÊU CẦU\]\nx/);
  assert.equal(llm.providers().mindtek, true);

  mtFail = true;
  await llm.generate({ prompt: 'x' }); await llm.generate({ prompt: 'x' }); // GROQ, GEMINI
  const r = await llm.generate({ prompt: 'x' }); // lượt của Mindtek -> lỗi -> chuyển Groq
  assert.equal(r.provider, 'GROQ');
  assert.equal(r.fallbackUsed, true);
  assert.equal(llm.providers().mindtek, false, 'Mindtek lỗi -> tạm nghỉ');
  assert.ok(llm.keyStatus().find((k) => k.provider === 'MINDTEK').coolingDownMs > 0);
  t = 31_000;
  assert.equal(llm.providers().mindtek, true, 'hết thời gian nghỉ -> dùng lại');

  // Chọn hẳn Mindtek cho chat; tra Google vẫn luôn Gemini.
  mtFail = false;
  const only = createLlmClient({ apiKeys: ['AIzaY'], configService: cfgOf({ AI_PROVIDER_CHAT: 'MINDTEK' }), transport: gem, logger: quiet, groq, mindtek });
  assert.equal((await only.generate({ prompt: 'x', task: 'CHAT' })).provider, 'MINDTEK');
  assert.equal((await only.generate({ prompt: 'x', search: true })).provider, 'GEMINI');
  // Tắt Mindtek / chưa có Bot ID -> không chia việc cho Mindtek.
  const off = createMindtekClient({ configService: cfgOf({ MINDTEK_BOT_ID: '' }), transport: { generate: () => assert.fail('không được gọi') } });
  assert.equal(off.available(), false);
});

let ctx; let app; const H = {};
const mtRequests = [];
const mindtekTransport = {
  async generate(req) {
    mtRequests.push(req);
    if (/Kiểm tra kết nối/.test(req.messages.at(-1).content)) return { text: 'OK' };
    return { text: '```json\n{"answer":"Trả lời bằng Mindtek: bạn chuẩn bị hồ sơ theo hướng dẫn của Nhà trường [1].","citations":[1],"insufficient":false}\n```' };
  },
};

before(async () => {
  ctx = await createTestContext({ llmTransport: createFakeTransport(), mindtekTransport });
  app = ctx.app;
  await createStaff(ctx.db, 'quantri', 'SUPER_ADMIN');
  await createStaff(ctx.db, 'phongts', 'ADMISSION_OFFICE');
  H.admin = await ctx.login('quantri'); H.office = await ctx.login('phongts');
  // Mindtek mặc định TẮT (bên thứ ba, endpoint không chính thức) -> bộ test này bật để kiểm tra tính năng.
  await ctx.c.configService.update('MINDTEK_ENABLED', 'true', { actorId: null, ip: null });
});
after(() => ctx.close());

test('chat qua khung HHT: chọn Mindtek trả lời, có tài liệu RAG trong tin nhắn, ghi thống kê Mindtek', async () => {
  await request(app).put('/api/admin/system/configs/AI_PROVIDER_CHAT').set(H.admin).send({ value: 'MINDTEK' }).expect(200);
  await request(app).put('/api/admin/system/configs/AI_PROVIDER_CHAT').set(H.admin).send({ value: 'OPENAI' }).expect(400);
  await request(app).put('/api/admin/system/configs/MINDTEK_BOT_ID').set(H.admin).send({ value: 'khong-hop-le' }).expect(400);
  await request(app).put('/api/admin/system/configs/MINDTEK_BASE_URL').set(H.admin).send({ value: 'http://abc.com/embed/x' }).expect(400);
  await ctx.c.configService.update('RAG_MIN_LEXICAL_SCORE', '0.1', { actorId: null, ip: null });
  await ctx.c.configService.update('FAQ_MATCH_SCORE', '0.99', { actorId: null, ip: null });
  await ctx.c.configService.update('FAQ_LEXICAL_MATCH_SCORE', '0.99', { actorId: null, ip: null });

  const s = await request(app).post('/api/chat/sessions').send({}).expect(201);
  const r = (await request(app).post('/api/chat/messages').send({ sessionId: s.body.sessionId, message: 'Bộ đội xuất ngũ nhập học cần giấy tờ gì?' }).expect(200)).body;
  assert.match(r.answer, /Trả lời bằng Mindtek/);
  const last = mtRequests.at(-1);
  assert.equal(last.botId, '1b94a3a9-eae9-4566-a648-ca2265f7e484');
  assert.match(last.messages.at(-1).content, /\[CHỈ DẪN HỆ THỐNG/);

  await ctx.c.aiMeter.flush();
  const st = (await request(app).get('/api/admin/ai/stats?days=7').set(H.admin).expect(200)).body;
  assert.ok(st.providers.MINDTEK.calls >= 1);
  assert.ok(st.daily.at(-1).MINDTEK.calls >= 1);
  assert.equal(st.routing.chat, 'MINDTEK');
  assert.ok(st.keys.some((k) => k.provider === 'MINDTEK'));
  const status = (await request(app).get('/api/admin/ai/status').set(H.admin).expect(200)).body;
  assert.equal(status.providers.mindtekConfigured, true);
});

test('kiểm tra kết nối có Mindtek; tắt Mindtek thì chat quay về Groq/Gemini', async () => {
  const { results } = (await request(app).post('/api/admin/ai/test-connection').set(H.admin).send({}).expect(200)).body;
  const mt = results.find((x) => x.provider === 'MINDTEK');
  assert.equal(mt.ok, true);
  assert.match(mt.message, /Kết nối Mindtek tốt/);

  await request(app).put('/api/admin/system/configs/MINDTEK_ENABLED').set(H.admin).send({ value: 'false' }).expect(200);
  const before = mtRequests.length;
  const s = await request(app).post('/api/chat/sessions').send({}).expect(201);
  await request(app).post('/api/chat/messages').send({ sessionId: s.body.sessionId, message: 'Học phí ngành công nghệ thông tin bao nhiêu?' }).expect(200);
  assert.equal(mtRequests.length, before, 'Mindtek tắt -> không gọi');
  assert.equal((await request(app).get('/api/admin/ai/status').set(H.admin).expect(200)).body.providers.mindtekConfigured, false);
});
