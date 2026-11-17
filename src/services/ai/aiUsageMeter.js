'use strict';
/**
 * Đồng hồ đo AI: ghi MỖI lần gọi Groq/Gemini/Mindtek vào bảng ai_calls (không lưu nội dung câu hỏi/trả lời),
 * phục vụ: ngân sách token riêng từng nhà cung cấp, thống kê trên trang Cài đặt AI, ước tính chi phí.
 * Ghi kiểu "bắn rồi quên": lỗi CSDL không làm hỏng câu trả lời của thí sinh.
 */
const { vnToday, addDays } = require('../../utils/time');

const TZ = "'Asia/Ho_Chi_Minh'";
const PROVIDERS = ['GROQ', 'GEMINI', 'MINDTEK'];
const TASKS = ['CHAT', 'WEB_SEARCH', 'OCR', 'RECOMMEND', 'ANALYTICS', 'EMBED', 'TEST', 'OTHER'];
const TODAY_TTL_MS = 20_000;

function createAiUsageMeter({ db, configService, logger = console } = {}) {
  const todayCache = new Map(); // provider -> { at, tokens }
  const pending = new Set();
  const cfg = (k, d) => (configService?.getOr ? configService.getOr(k, d) : d);

  function record({ provider, task = 'OTHER', model = null, keyLabel = null, ok, latencyMs = 0, tokensIn = 0, tokensOut = 0, fallback = false, errorKind = null }) {
    if (!db || !PROVIDERS.includes(provider)) return;
    const t = TASKS.includes(task) ? task : 'OTHER';
    const cached = todayCache.get(provider);
    if (cached) cached.tokens += (tokensIn || 0) + (tokensOut || 0);
    const p = db.query(
      `INSERT INTO ai_calls (provider, task, model, key_label, ok, latency_ms, tokens_in, tokens_out, fallback, error_kind)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [provider, t, model ? String(model).slice(0, 80) : null, keyLabel ? String(keyLabel).slice(0, 80) : null, Boolean(ok),
        Math.max(0, Math.round(latencyMs || 0)), Math.max(0, tokensIn || 0), Math.max(0, tokensOut || 0), Boolean(fallback),
        errorKind ? String(errorKind).slice(0, 40) : null],
    ).catch((err) => logger.warn(`[ai-meter] không ghi được: ${err.message}`)).finally(() => pending.delete(p));
    pending.add(p);
  }

  /** Token đã dùng hôm nay (giờ VN) của một nhà cung cấp – có đệm ngắn để không truy vấn mỗi câu hỏi. */
  async function tokensToday(provider) {
    const c = todayCache.get(provider);
    if (c && Date.now() - c.at < TODAY_TTL_MS) return c.tokens;
    const { rows } = await db.query(
      `SELECT COALESCE(SUM(tokens_in + tokens_out), 0)::bigint AS n FROM ai_calls
        WHERE provider = ? AND (created_at AT TIME ZONE ${TZ})::date = ?::date`, [provider, vnToday()]);
    const tokens = Number(rows[0].n);
    todayCache.set(provider, { at: Date.now(), tokens });
    return tokens;
  }

  /** Nhà cung cấp còn trong ngân sách riêng (0 = không giới hạn riêng). */
  async function withinBudget(provider) {
    const budget = Number(cfg(`${provider}_DAILY_TOKEN_BUDGET`, 0)) || 0;
    if (!budget || !db) return true;
    try { return (await tokensToday(provider)) < budget; } catch { return true; }
  }

  function prices() {
    return {
      GROQ: { in: Number(cfg('PRICE_GROQ_IN', 0.15)), out: Number(cfg('PRICE_GROQ_OUT', 0.6)) },
      GEMINI: { in: Number(cfg('PRICE_GEMINI_IN', 0.3)), out: Number(cfg('PRICE_GEMINI_OUT', 2.5)) },
      // Mindtek tính theo gói thuê bao của nền tảng, không theo token -> mặc định 0 (token chỉ là ước lượng).
      MINDTEK: { in: Number(cfg('PRICE_MINDTEK_IN', 0)), out: Number(cfg('PRICE_MINDTEK_OUT', 0)) },
      searchPer1000: Number(cfg('PRICE_GEMINI_SEARCH_PER_1000', 35)),
      usdVnd: Number(cfg('USD_VND_RATE', 26000)),
    };
  }

  /** Thống kê N ngày gần nhất (giờ VN): theo ngày × nhà cung cấp, theo việc, tổng, chi phí ước tính. */
  async function stats(days = 14) {
    const n = Math.min(Math.max(Number(days) || 14, 1), 90);
    const to = vnToday();
    const from = addDays(to, -(n - 1));
    const p = [from, to];
    const inRange = `(created_at AT TIME ZONE ${TZ})::date BETWEEN ?::date AND ?::date`;
    const agg = `COUNT(*)::int AS calls, COUNT(*) FILTER (WHERE NOT ok)::int AS errors, COUNT(*) FILTER (WHERE fallback)::int AS fallbacks,
                 COALESCE(SUM(tokens_in), 0)::bigint AS tokens_in, COALESCE(SUM(tokens_out), 0)::bigint AS tokens_out,
                 COALESCE(AVG(latency_ms) FILTER (WHERE ok), 0)::int AS avg_ms,
                 COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE ok), 0)::int AS p95_ms`;
    const [byDay, byTask, byProvider, errors, searchDaily] = await Promise.all([
      db.query(`SELECT to_char((created_at AT TIME ZONE ${TZ})::date, 'YYYY-MM-DD') AS day, provider, ${agg}
                  FROM ai_calls WHERE ${inRange} GROUP BY 1, 2`, p),
      db.query(`SELECT task, provider, ${agg} FROM ai_calls WHERE ${inRange} GROUP BY 1, 2 ORDER BY 1, 2`, p),
      db.query(`SELECT provider, ${agg} FROM ai_calls WHERE ${inRange} GROUP BY 1`, p),
      db.query(`SELECT provider, COALESCE(error_kind, 'KHÁC') AS kind, COUNT(*)::int AS n FROM ai_calls
                 WHERE NOT ok AND ${inRange} GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 20`, p),
      // Tra Google: miễn phí 1.500 lượt/ngày, vượt mới tính phí.
      db.query(`SELECT (created_at AT TIME ZONE ${TZ})::date AS day, COUNT(*)::int AS n FROM ai_calls
                 WHERE provider = 'GEMINI' AND task = 'WEB_SEARCH' AND ok AND ${inRange} GROUP BY 1`, p),
    ]);
    const num = (r) => ({
      calls: r.calls, errors: r.errors, fallbacks: r.fallbacks, tokensIn: Number(r.tokens_in), tokensOut: Number(r.tokens_out),
      avgMs: r.avg_ms, p95Ms: r.p95_ms, errorRate: r.calls ? Math.round((r.errors / r.calls) * 1000) / 10 : 0,
    });
    const pr = prices();
    const costOf = (provider, tin, tout) => (tin * pr[provider].in + tout * pr[provider].out) / 1e6;

    const dayMap = new Map(byDay.rows.map((r) => [`${r.day}|${r.provider}`, num(r)]));
    const empty = { calls: 0, errors: 0, fallbacks: 0, tokensIn: 0, tokensOut: 0, avgMs: 0, p95Ms: 0, errorRate: 0 };
    const daily = Array.from({ length: n }, (_, i) => {
      const day = addDays(from, i);
      const row = { day };
      for (const pv of PROVIDERS) row[pv] = dayMap.get(`${day}|${pv}`) || empty;
      return row;
    });
    const providers = Object.fromEntries(PROVIDERS.map((pv) => {
      const r = byProvider.rows.find((x) => x.provider === pv);
      const s = r ? num(r) : { ...empty };
      return [pv, { ...s, costUsd: costOf(pv, s.tokensIn, s.tokensOut) }];
    }));
    const paidSearches = searchDaily.rows.reduce((s, r) => s + Math.max(0, r.n - 1500), 0);
    const searchUsd = (paidSearches / 1000) * pr.searchPer1000;
    const totalUsd = providers.GROQ.costUsd + providers.GEMINI.costUsd + providers.MINDTEK.costUsd + searchUsd;
    return {
      from, to, days: n, daily,
      tasks: byTask.rows.map((r) => ({ task: r.task, provider: r.provider, ...num(r), costUsd: costOf(r.provider, Number(r.tokens_in), Number(r.tokens_out)) })),
      providers,
      errors: errors.rows,
      cost: {
        prices: pr, groqUsd: providers.GROQ.costUsd, geminiUsd: providers.GEMINI.costUsd, mindtekUsd: providers.MINDTEK.costUsd,
        searches: searchDaily.rows.reduce((s, r) => s + r.n, 0), paidSearches, searchUsd, totalUsd,
        totalVnd: Math.round(totalUsd * pr.usdVnd),
        monthlyUsd: (totalUsd / n) * 30, monthlyVnd: Math.round(((totalUsd / n) * 30) * pr.usdVnd),
      },
      today: {
        GROQ: { tokens: await tokensToday('GROQ').catch(() => 0), budget: Number(cfg('GROQ_DAILY_TOKEN_BUDGET', 0)) || 0 },
        GEMINI: { tokens: await tokensToday('GEMINI').catch(() => 0), budget: Number(cfg('GEMINI_DAILY_TOKEN_BUDGET', 0)) || 0 },
        MINDTEK: { tokens: await tokensToday('MINDTEK').catch(() => 0), budget: Number(cfg('MINDTEK_DAILY_TOKEN_BUDGET', 0)) || 0 },
      },
    };
  }

  /** Chờ các lần ghi đang dở (test, tắt máy chủ). */
  const flush = () => Promise.all([...pending]);
  const resetCache = () => todayCache.clear();

  return { record, tokensToday, withinBudget, stats, prices, flush, resetCache };
}

module.exports = { createAiUsageMeter, TASKS, PROVIDERS };
