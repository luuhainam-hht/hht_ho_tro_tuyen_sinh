'use strict';
/**
 * Nâng cấp vận hành cho Trường (11/2026):
 *  - bộ nhớ đệm không dùng chung câu trả lời giữa hai trang ngành, và không dùng khi phiên đã có lịch sử;
 *  - tra Internet chỉ nhận nguồn thuộc tên miền cho phép;
 *  - migration đưa 4 cấu hình rủi ro về TẮT nhưng không ghi đè lựa chọn Admin đã sửa;
 *  - giới hạn tần suất chat theo phiên: một người gõ nhanh bị chặn, người khác cùng IP vẫn hỏi được.
 */
process.env.TEST_FAKE_LLM = '1';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { createTestContext, createStaff, silent } = require('./helpers/testContext');
const { createFakeTransport } = require('./helpers/fakeLlm');
const { runMigrations } = require('../src/migrations/runMigrations');
const { createRateLimits } = require('../src/middleware/rateLimits');

let ctx; let app; let mode = 'good';
const transport = createFakeTransport({
  responder: (req) => {
    if (req.search) {
      if (mode === 'web-foreign') {
        return { text: 'Trường có hồ bơi tiêu chuẩn cho sinh viên luyện tập.', webSources: [{ title: 'tuyensinh247.com', url: 'https://diemthi.tuyensinh247.com/x' }] };
      }
      return { text: 'KHONG_TIM_THAY', webSources: [] };
    }
    return { answer: 'Hồ sơ của bộ đội xuất ngũ cần Thẻ học nghề bản gốc và Quyết định xuất ngũ bản công chứng [1].', citations: [1], intent: 'HO_SO', topics: ['HO_SO'], major_codes: [], insufficient: false };
  },
});

before(async () => {
  ctx = await createTestContext({ llmTransport: transport });
  app = ctx.app;
  await ctx.c.ingestService.reembedMissing();
});
after(() => ctx.close());

const newSession = async () => (await request(app).post('/api/chat/sessions').send({}).expect(201)).body.sessionId;
const send = async (sessionId, message, majorCode) => (await request(app).post('/api/chat/messages')
  .send({ sessionId, message, ...(majorCode ? { majorCode } : {}) }).expect(200)).body;
const setCfg = (k, v) => ctx.c.configService.update(k, v, { actorId: null, ip: null });

test('cache: câu trả lời ở trang ngành A không được dùng lại ở trang ngành B', async () => {
  const q = 'Bộ đội xuất ngũ cần chuẩn bị giấy tờ gì để nhập học?';
  assert.equal((await send(await newSession(), q, '6520123')).source, 'RAG');
  assert.equal((await send(await newSession(), q, '6520123')).source, 'CACHE', 'cùng ngành -> dùng cache');
  const other = await send(await newSession(), q, '6520121');
  assert.notEqual(other.source, 'CACHE', 'ngành khác -> không dùng câu trả lời của ngành trước');
});

test('cache: phiên đã có lịch sử hội thoại thì không đọc và không ghi cache', async () => {
  const q = 'Bộ đội xuất ngũ cần nộp những giấy tờ gì khi nhập học?';
  const sid = await newSession();
  await send(sid, 'Trường có những ngành nào cho bộ đội xuất ngũ?');
  const before = transport.calls.generate;
  const inHistory = await send(sid, q);
  assert.notEqual(inHistory.source, 'CACHE');
  // Câu trả lời trong phiên có lịch sử không được ghi cache -> phiên mới vẫn phải hỏi AI.
  const fresh = await send(await newSession(), q);
  assert.notEqual(fresh.source, 'CACHE');
  assert.ok(transport.calls.generate >= before + 2);
  // Thử trợ lý trên trang quản trị cho biết vì sao không dùng cache
  const preview = await ctx.c.answerService.preview({ message: q });
  assert.equal(preview.trace.cache.reason, 'DRY_RUN');
});

test('tra Internet: nguồn ngoài tên miền cho phép (trang tổng hợp) bị loại -> báo hotline, không trả lời theo nguồn đó', async () => {
  await setCfg('RAG_MIN_SCORE', '0.99');
  mode = 'web-foreign';
  const r = await send(await newSession(), 'Trường có hồ bơi cho sinh viên không?');
  assert.notEqual(r.source, 'WEB');
  assert.doesNotMatch(r.answer, /hồ bơi tiêu chuẩn/);
  const preview = await ctx.c.answerService.preview({ message: 'Trường có hồ bơi cho sinh viên không?' });
  assert.equal(preview.trace.web.accepted, false);
  assert.equal(preview.trace.web.rejectedSources, 1);
  assert.match(preview.trace.web.reason, /không thuộc hht\.edu\.vn/);
  // Admin thêm tên miền -> nguồn được nhận
  await setCfg('AI_WEB_ALLOWED_DOMAINS', 'hht.edu.vn, tuyensinh247.com');
  assert.equal((await send(await newSession(), 'Trường có hồ bơi cho sinh viên không?')).source, 'WEB');
  await setCfg('AI_WEB_ALLOWED_DOMAINS', 'hht.edu.vn');
  await setCfg('RAG_MIN_SCORE', '0.6');
  mode = 'good';
});

test('migration: 4 cấu hình rủi ro về TẮT, giữ nguyên giá trị Admin đã tự sửa, xóa cache cũ', async () => {
  const adminId = await createStaff(ctx.db, 'quantri_mig', 'SUPER_ADMIN');
  // Giả lập CSDL đang chạy bản cũ: KB_AUTO_PUBLISH/RAG_ALL_YEARS để mặc định (true), MINDTEK do Admin chủ động bật.
  await ctx.db.query("UPDATE system_configs SET value = 'true', updated_by = NULL WHERE key IN ('KB_AUTO_PUBLISH', 'RAG_ALL_YEARS', 'AI_WEB_GENERAL_ENABLED')");
  await ctx.db.query("UPDATE system_configs SET value = 'true', updated_by = ? WHERE key = 'MINDTEK_ENABLED'", [adminId]);
  await ctx.db.query("DELETE FROM schema_migrations WHERE id = '2026-11-24-safe-defaults-for-production'");
  assert.ok(Number((await ctx.db.query('SELECT COUNT(*) AS n FROM answer_cache')).rows[0].n) > 0, 'có cache từ test trước');

  await runMigrations(ctx.db, { logger: silent, seed: false });
  const { rows } = await ctx.db.query("SELECT key, value FROM system_configs WHERE key IN ('KB_AUTO_PUBLISH', 'RAG_ALL_YEARS', 'AI_WEB_GENERAL_ENABLED', 'MINDTEK_ENABLED')");
  const v = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  assert.deepEqual(v, { KB_AUTO_PUBLISH: 'false', RAG_ALL_YEARS: 'false', AI_WEB_GENERAL_ENABLED: 'false', MINDTEK_ENABLED: 'true' });
  assert.equal(Number((await ctx.db.query('SELECT COUNT(*) AS n FROM answer_cache')).rows[0].n), 0, 'cache khóa cũ bị xóa');
  await ctx.c.configService.loadAll();
});

test('giới hạn tần suất: một phiên gõ quá nhanh bị 429, phiên khác cùng IP vẫn hỏi được', async () => {
  const limits = createRateLimits({ enabled: true });
  const mini = express();
  mini.use(express.json());
  mini.post('/m', limits.chat, (_req, res) => res.json({ ok: true }));
  const a = '0f8fad5b-d9cb-469f-a165-70867728950e';
  const b = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
  for (let i = 0; i < 12; i += 1) await request(mini).post('/m').send({ sessionId: a }).expect(200);
  const blocked = await request(mini).post('/m').send({ sessionId: a }).expect(429);
  assert.match(blocked.body.error, /quá nhanh/);
  await request(mini).post('/m').send({ sessionId: b }).expect(200);
});
