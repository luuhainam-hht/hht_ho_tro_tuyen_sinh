'use strict';
/** Nhánh LLM với transport giả: dùng ngữ cảnh, kiểm tra trích dẫn, cache theo phiên bản kho, xoay key, ngân sách token. */
process.env.TEST_FAKE_LLM = '1';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createTestContext } = require('./helpers/testContext');
const { createFakeTransport } = require('./helpers/fakeLlm');

let ctx; let app; let mode = 'good';
const transport = createFakeTransport({
  responder: () => {
    if (mode === 'invented') return { answer: 'Học phí ngành này là 9.999.000 đồng/tháng [1].', citations: [1], intent: 'HOC_PHI', topics: ['HOC_PHI'], major_codes: [], insufficient: false };
    if (mode === 'garbage') return 'không phải JSON';
    return { answer: 'Hồ sơ của bộ đội xuất ngũ cần Thẻ học nghề bản gốc và Quyết định xuất ngũ bản công chứng [1].', citations: [1], intent: 'HO_SO', topics: ['HO_SO', 'DOI_TUONG_DAC_BIET'], major_codes: [], insufficient: false };
  },
  failKeys: new Set(['fake-key-1']),
});

before(async () => {
  ctx = await createTestContext({ llmTransport: transport });
  app = ctx.app;
  await ctx.c.ingestService.reembedMissing(); // tạo vector cho kho + FAQ bằng embed giả
});
after(() => ctx.close());

async function ask(message) {
  const s = await request(app).post('/api/chat/sessions').send({}).expect(201);
  return (await request(app).post('/api/chat/messages').send({ sessionId: s.body.sessionId, message }).expect(200)).body;
}

test('LLM trả lời có trích dẫn hợp lệ; key lỗi 429 tự chuyển key khác; token được đếm', async () => {
  const r = await ask('Bộ đội xuất ngũ cần chuẩn bị giấy tờ gì để nhập học?');
  assert.equal(r.source, 'RAG');
  assert.equal(r.answerMode, 'LLM');
  assert.match(r.answer, /Thẻ học nghề/);
  assert.ok(r.citations.length >= 1 && r.citations[0].chunkId);
  assert.ok(transport.calls.keysUsed.includes('fake-key-2'));
  const { rows } = await ctx.db.query('SELECT tokens_in + tokens_out AS t FROM token_usage_daily');
  assert.ok(Number(rows[0].t) >= 160);
});

test('câu hỏi lặp lại lấy từ cache; công bố tài liệu mới làm cache hết hiệu lực', async () => {
  const before = transport.calls.generate;
  assert.equal((await ask('Bộ đội xuất ngũ cần chuẩn bị giấy tờ gì để nhập học?')).source, 'CACHE');
  assert.equal(transport.calls.generate, before);
  await ctx.db.query("UPDATE kb_documents SET updated_at = now() WHERE source_code = 'S03'");
  assert.equal((await ask('Bộ đội xuất ngũ cần chuẩn bị giấy tờ gì để nhập học?')).source, 'RAG');
});

test('LLM bịa con số không có trong văn bản -> bị loại, chuyển sang trích nguyên văn', async () => {
  mode = 'invented';
  const r = await ask('Bộ đội xuất ngũ học ngành nào, học phí bao nhiêu?');
  assert.doesNotMatch(r.answer, /9\.999\.000/);
  assert.notEqual(r.answerMode, 'LLM');
  mode = 'garbage';
  const g = await ask('Bộ đội xuất ngũ được hỗ trợ những quyền lợi gì khi học?');
  assert.ok(['RAG', 'FAQ'].includes(g.source));
  assert.notEqual(g.answerMode, 'LLM');
  mode = 'good';
});

test('vượt ngân sách token/ngày -> không gọi LLM nữa nhưng vẫn trả lời', async () => {
  await ctx.c.configService.update('DAILY_TOKEN_BUDGET', '1', { actorId: null, ip: null });
  const before = transport.calls.generate;
  const r = await ask('Thông tin về quyết định xuất ngũ khi nộp hồ sơ nhập học ở trường');
  assert.equal(transport.calls.generate, before);
  assert.notEqual(r.answerMode, 'LLM');
});
