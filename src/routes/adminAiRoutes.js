'use strict';
/**
 * Trang Cài đặt AI (chỉ SUPER_ADMIN): trạng thái, khóa API, xem trước lời nhắc, thử câu hỏi, xóa bộ nhớ đệm.
 * Tham số AI (mô hình, nhiệt độ, giọng văn…) vẫn lưu qua PUT /api/admin/system/configs/:key
 * để có chung kiểm tra biên + nhật ký + đồng bộ CONFIG_UPDATED.
 */
const express = require('express');
const v = require('../utils/validate');
const ah = require('../utils/asyncHandler');
const { requirePermission } = require('../middleware/auth');
const { vnToday, addDays } = require('../utils/time');
const { systemPromptFromConfig } = require('../services/ai/promptBuilder');
const auditRepository = require('../repositories/auditRepository');

const USAGE_DAYS = 14;

module.exports = function adminAiRoutes({ db, env, configService, llm, aiKeyService, answerService, aiMeter }) {
  const r = express.Router();
  r.use(requirePermission('CONFIG'));

  r.get('/status', ah(async (_req, res) => {
    const today = vnToday();
    const from = addDays(today, -(USAGE_DAYS - 1));
    const [usage, cache, sources, keys] = await Promise.all([
      db.query(`SELECT to_char(day, 'YYYY-MM-DD') AS day, tokens_in, tokens_out, requests FROM token_usage_daily
                 WHERE day BETWEEN ?::date AND ?::date ORDER BY day`, [from, today]),
      db.query('SELECT COUNT(*)::int AS entries, COALESCE(SUM(hit_count), 0)::int AS hits FROM answer_cache WHERE expires_at > now()'),
      db.query(`SELECT source, COALESCE(answer_mode, '') AS mode, COUNT(*)::int AS n FROM chat_messages
                 WHERE role = 'ASSISTANT' AND created_at >= now() - interval '7 days' GROUP BY 1, 2 ORDER BY n DESC`),
      aiKeyService.list(),
    ]);
    const byDay = new Map(usage.rows.map((u) => [u.day, u]));
    const days = Array.from({ length: USAGE_DAYS }, (_, i) => {
      const day = addDays(from, i);
      const u = byDay.get(day);
      return { day, tokens: u ? Number(u.tokens_in) + Number(u.tokens_out) : 0, requests: u ? Number(u.requests) : 0 };
    });
    res.json({
      enabled: llm.enabled(),
      available: llm.available(),
      model: configService.get('LLM_MODEL'),
      fallbackModel: configService.get('LLM_FALLBACK_MODEL') || null,
      providers: llm.providers ? llm.providers() : null,
      groqModel: configService.getOr('GROQ_MODEL', null),
      embeddingModel: configService.get('EMBEDDING_MODEL'),
      budget: configService.get('DAILY_TOKEN_BUDGET'),
      todayTokens: days[days.length - 1].tokens,
      usage: days,
      cache: cache.rows[0],
      sources: sources.rows,
      keys,
      envKeys: llm.keyStatus().filter((k) => k.source === 'ENV'),
      secretIsEphemeral: env.SECRET_IS_EPHEMERAL,
    });
  }));

  /** Thống kê chi tiết: theo ngày × nhà cung cấp, theo việc, độ trễ, lỗi, tự chuyển bên, khóa, nguồn trả lời, chi phí. */
  r.get('/stats', ah(async (req, res) => {
    const days = Math.min(Math.max(Number.parseInt(req.query.days, 10) || 14, 1), 90);
    const [meter, sources] = await Promise.all([
      aiMeter ? aiMeter.stats(days) : null,
      db.query(`SELECT COALESCE(source, '?') AS source, COUNT(*)::int AS n FROM chat_messages
                 WHERE role = 'ASSISTANT' AND created_at >= now() - make_interval(days => ?) GROUP BY 1 ORDER BY n DESC`, [days]),
    ]);
    res.json({
      ...(meter || {}),
      routing: llm.providers ? llm.providers() : null,
      keys: llm.keyStatus().map(({ label, id, source, provider, calls = 0, errors = 0, successes = 0, coolingDownMs, failures, lastError, lastUsedAt }) => ({
        label, id, source, provider, calls, errors, successes, coolingDownMs, failures, lastError, lastUsedAt,
      })),
      sources: sources.rows,
    });
  }));

  r.get('/prompt-preview', (_req, res) => res.json({ prompt: systemPromptFromConfig(configService) }));

  r.post('/test-connection', ah(async (_req, res) => res.json({ results: await llm.testAll() })));

  r.post('/try', ah(async (req, res) => {
    const message = v.str(req.body, 'message', { label: 'Câu hỏi', required: true, max: 1000 });
    res.json(await answerService.preview({ message }));
  }));

  r.post('/cache/clear', ah(async (req, res) => {
    const { rowCount } = await db.query('DELETE FROM answer_cache');
    await auditRepository.insert(db, { actorId: req.user.id, action: 'AI_CACHE_CLEAR', targetType: 'AI', payload: { removed: rowCount }, ip: req.ip });
    res.json({ removed: rowCount });
  }));

  // --- Khóa API ---
  const label = (body, required) => v.str(body, 'label', { label: 'Tên gợi nhớ', required, max: 60 });
  r.get('/keys', ah(async (_req, res) => res.json({ items: await aiKeyService.list() })));
  r.post('/keys', ah(async (req, res) => res.status(201).json({
    key: await aiKeyService.add({ label: label(req.body, true), apiKey: v.str(req.body, 'apiKey', { label: 'Khóa API', required: true, max: 200 }), actor: req.user, ip: req.ip }),
  })));
  r.post('/keys/test', ah(async (req, res) => res.json(await aiKeyService.testRaw(v.str(req.body, 'apiKey', { label: 'Khóa API', required: true, max: 200 })))));
  r.put('/keys/:id', ah(async (req, res) => res.json({
    key: await aiKeyService.update(v.idParam(req.params), { label: label(req.body, false) ?? undefined, isActive: v.bool(req.body, 'isActive') ?? undefined, actor: req.user, ip: req.ip }),
  })));
  r.delete('/keys/:id', ah(async (req, res) => res.json(await aiKeyService.remove(v.idParam(req.params), { actor: req.user, ip: req.ip }))));
  r.post('/keys/:id/test', ah(async (req, res) => res.json(await aiKeyService.test(v.idParam(req.params)))));
  return r;
};
