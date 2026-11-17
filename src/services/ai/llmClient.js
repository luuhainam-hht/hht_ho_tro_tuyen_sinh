'use strict';
/**
 * Cửa ngõ duy nhất tới LLM: sinh câu (generate) và tạo vector (embed) qua key pool, đếm token.
 * Mọi tham số (model, model dự phòng, nhiệt độ, thời gian chờ, bật/tắt) đọc từ system_configs MỖI lần gọi
 * -> Admin đổi trên giao diện có hiệu lực ngay, không sửa mã, không khởi động lại.
 * Danh sách khóa nạp lại được (setKeys) khi Admin thêm/xóa khóa API.
 * transport có thể thay (test dùng bản giả; đổi nhà cung cấp chỉ viết transport mới).
 *
 * Phân việc giữa hai nhà cung cấp (Admin chọn trên trang Cài đặt AI):
 *  - CHAT (trả lời thí sinh)      : AI_PROVIDER_CHAT      (mặc định GROQ)
 *  - RECOMMEND (gợi ý ngành)      : AI_PROVIDER_RECOMMEND (mặc định GROQ, mô hình nhỏ GROQ_SMALL_MODEL)
 *  - ANALYTICS (phân tích Tổng quan): AI_PROVIDER_ANALYTICS (mặc định GEMINI)
 *    Giá trị AUTO | GROQ | GEMINI; AUTO = Groq trước nếu có khóa. Lỗi / hết ngân sách riêng -> tự chuyển bên còn lại.
 *  - WEB_SEARCH (tra Google), OCR (đọc ảnh/PDF scan), EMBED (vector): chỉ Gemini làm được.
 * Mỗi lần gọi được ghi vào ai_calls (aiUsageMeter) để thống kê, tính ngân sách và chi phí.
 */
const { GoogleGenAI } = require('@google/genai');
const { createGeminiKeyPool, classifyError } = require('./geminiKeyPool');
const { isGroqKey } = require('./groqClient');

const DEFAULT_TIMEOUT_MS = 20_000;
const EMBED_BATCH_SIZE = 50;
const TEST_PROMPT = 'Trả lời đúng một từ: OK';

function createGeminiTransport() {
  const clients = new Map();
  const client = (apiKey) => {
    if (!clients.has(apiKey)) clients.set(apiKey, new GoogleGenAI({ apiKey }));
    return clients.get(apiKey);
  };
  return {
    async generate(apiKey, { model, system, contents, temperature, maxTokens, json, search = false, timeoutMs = DEFAULT_TIMEOUT_MS }) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await client(apiKey).models.generateContent({
          model,
          contents,
          config: {
            systemInstruction: system, temperature, maxOutputTokens: maxTokens, abortSignal: controller.signal,
            // Google Search grounding không dùng chung được với đầu ra JSON -> hai chế độ tách biệt.
            ...(search ? { tools: [{ googleSearch: {} }] } : json ? { responseMimeType: 'application/json' } : {}),
          },
        });
        const usage = res.usageMetadata || {};
        const out = { text: (res.text || '').trim(), tokensIn: usage.promptTokenCount || 0, tokensOut: usage.candidatesTokenCount || 0 };
        if (search) out.webSources = extractWebSources(res);
        return out;
      } finally {
        clearTimeout(timer);
      }
    },
    async embed(apiKey, { model, texts, dim, taskType }) {
      const res = await client(apiKey).models.embedContent({
        model, contents: texts, config: { outputDimensionality: dim, taskType },
      });
      return res.embeddings.map((e) => e.values);
    },
  };
}

/** Nguồn web từ groundingMetadata của Gemini (Google Search): [{ title, url }], bỏ trùng. */
function extractWebSources(res) {
  const chunks = res?.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
  const seen = new Set();
  const out = [];
  for (const ch of chunks) {
    const url = ch?.web?.uri;
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push({ title: String(ch.web.title || url).slice(0, 200), url });
  }
  return out;
}

/** Lỗi kỹ thuật -> câu tiếng Việt cho cán bộ (trang Cài đặt AI). */
function describeLlmError(err) {
  const kind = classifyError(err);
  const msg = String(err?.message || '');
  if (/is not found|NOT_FOUND/i.test(msg)) return 'Không tìm thấy mô hình này (sai tên hoặc khóa không được dùng mô hình này)';
  if (kind === 'AUTH') return 'Khóa API sai, đã bị thu hồi hoặc chưa bật Gemini API';
  if (kind === 'RATE_LIMIT') return 'Khóa đã hết hạn mức (quota) hoặc gọi quá nhanh, thử lại sau';
  if (kind === 'BAD_REQUEST') return `Yêu cầu không hợp lệ: ${msg.slice(0, 160)}`;
  if (kind === 'SERVER') return 'Máy chủ Google đang lỗi tạm thời';
  if (err?.name === 'AbortError' || /abort/i.test(msg)) return 'Quá thời gian chờ phản hồi';
  return `Không kết nối được tới Google: ${msg.slice(0, 160)}`;
}

const TASK_PROVIDER_KEY = { CHAT: 'AI_PROVIDER_CHAT', RECOMMEND: 'AI_PROVIDER_RECOMMEND', ANALYTICS: 'AI_PROVIDER_ANALYTICS' };
const TASK_DEFAULT = { CHAT: 'GROQ', RECOMMEND: 'GROQ', ANALYTICS: 'GEMINI' };

function createLlmClient({ apiKeys = [], configService, transport = createGeminiTransport(), logger = console, groq = null, meter = null }) {
  const envKeys = apiKeys.map((key, i) => ({ key, label: `.env #${i + 1}`, source: 'ENV' }));
  let pool = createGeminiKeyPool(envKeys, { logger });
  const cfg = (key, fallback) => (configService.getOr ? configService.getOr(key, fallback) : configService.get(key));

  /** Nạp lại khóa: khóa .env + khóa Admin thêm (đã giải mã). Giữ trạng thái nghỉ của khóa cũ. */
  function setKeys(extraKeys = []) {
    pool = createGeminiKeyPool([...envKeys, ...extraKeys], { logger, state: pool.exportState() });
    return pool.size;
  }

  const enabled = () => cfg('AI_ENABLED', true) !== false;
  /** Gemini sẵn sàng: cần cho tra Google, vector, đọc ảnh/PDF. */
  const geminiAvailable = () => enabled() && pool.size > 0 && pool.available() > 0;
  const groqAvailable = () => enabled() && Boolean(groq?.available());
  /** Có ít nhất một nhà cung cấp sinh câu trả lời. */
  const available = () => geminiAvailable() || groqAvailable();
  /** Nhà cung cấp chính đã cấu hình cho một việc: GROQ | GEMINI | AUTO. */
  const providerFor = (task) => {
    const v = String(cfg(TASK_PROVIDER_KEY[task], TASK_DEFAULT[task] || 'GEMINI') || 'AUTO').toUpperCase();
    return ['GROQ', 'GEMINI', 'AUTO'].includes(v) ? v : 'AUTO';
  };
  const inBudget = (provider) => (meter ? meter.withinBudget(provider) : Promise.resolve(true));

  function request(model, { system, contents, json, maxTokens, search = false, timeoutMs, temperature }) {
    return {
      model, system, contents, json, search,
      temperature: temperature ?? cfg('LLM_TEMPERATURE', 0.2),
      maxTokens: maxTokens ?? cfg('MAX_ANSWER_TOKENS', 800),
      timeoutMs: timeoutMs ?? cfg('LLM_TIMEOUT_SECONDS', 20) * 1000,
    };
  }

  /**
   * attachments: [{ mimeType, data (base64) }] – tệp gửi kèm (AI đọc ảnh/PDF scan khi nạp tài liệu).
   * timeoutMs/temperature: ghi đè cấu hình cho tác vụ nền (đọc tài liệu cần lâu hơn câu hỏi của thí sinh).
   */
  async function generate({ system, history = [], prompt, json = false, maxTokens, search = false, attachments = [], timeoutMs, temperature, task }) {
    // Việc chỉ Gemini làm được suy ra từ tham số; còn lại mặc định là CHAT.
    const t = search ? 'WEB_SEARCH' : attachments.length ? 'OCR' : (task || 'CHAT');
    const contents = [
      ...history.map((h) => ({ role: h.role === 'USER' ? 'user' : 'model', parts: [{ text: h.content }] })),
      { role: 'user', parts: [...attachments.map((a) => ({ inlineData: { mimeType: a.mimeType, data: a.data } })), { text: prompt }] },
    ];
    const opts = { system, contents, json, maxTokens, search, timeoutMs, temperature, task: t };
    const geminiOnly = Boolean(search || attachments.length || !TASK_PROVIDER_KEY[t]);
    const [groqBudget, geminiBudget] = await Promise.all([inBudget('GROQ'), inBudget('GEMINI')]);
    const groqCan = !geminiOnly && groqAvailable() && groqBudget;
    const geminiCan = geminiAvailable() && geminiBudget;
    if (geminiOnly && geminiAvailable() && !geminiBudget) throw budgetError('GEMINI');
    const pref = providerFor(t);
    const groqFirst = groqCan && (pref !== 'GEMINI' || !geminiCan);
    const viaGroq = (crossFallback) => groq.generate({ system, history, prompt, json, maxTokens, timeoutMs, temperature, task: t, small: t === 'RECOMMEND', crossFallback });
    if (groqFirst) {
      try {
        return await viaGroq(false);
      } catch (err) {
        if (!geminiCan) throw err;
        logger.warn(`[llm] Groq lỗi (${String(err.message).slice(0, 120)}), chuyển sang Gemini`);
        return viaGemini(opts, true);
      }
    }
    if (!geminiCan) {
      if (!geminiBudget && geminiAvailable()) throw budgetError('GEMINI');
      if (!groqBudget && groqAvailable() && !geminiOnly) throw budgetError('GROQ');
    }
    try {
      return await viaGemini(opts, false);
    } catch (err) {
      if (!groqCan) throw err;
      logger.warn(`[llm] Gemini lỗi (${String(err.message).slice(0, 120)}), chuyển sang Groq`);
      return viaGroq(true);
    }
  }

  function budgetError(provider) {
    const err = new Error(`${provider === 'GROQ' ? 'Groq' : 'Gemini'} đã dùng hết ngân sách token hôm nay`);
    err.code = 'PROVIDER_BUDGET';
    return err;
  }

  /** Một lần gọi Gemini với một mô hình + ghi đồng hồ đo. */
  async function geminiAttempt(model, opts, fallback) {
    const started = Date.now();
    let label = null;
    try {
      const res = await pool.run((key, entry) => { label = entry?.label || null; return transport.generate(key, request(model, opts)); });
      meter?.record({ provider: 'GEMINI', task: opts.task, model, keyLabel: label, ok: true, latencyMs: Date.now() - started, tokensIn: res.tokensIn, tokensOut: res.tokensOut, fallback });
      return res;
    } catch (err) {
      meter?.record({ provider: 'GEMINI', task: opts.task, model, keyLabel: label, ok: false, latencyMs: Date.now() - started, fallback, errorKind: err?.code === 'NO_KEY_AVAILABLE' ? 'NO_KEY' : classifyError(err) });
      throw err;
    }
  }

  async function viaGemini(opts, crossFallback = false) {
    const model = cfg('LLM_MODEL', 'gemini-2.5-flash');
    try {
      const res = await geminiAttempt(model, opts, crossFallback);
      return { ...res, model, provider: 'GEMINI', ...(crossFallback ? { fallbackUsed: true } : {}) };
    } catch (err) {
      // Mô hình chính lỗi (sai tên, quá tải, mọi khóa đều nghỉ…) -> thử mô hình dự phòng một lần.
      const fallback = cfg('LLM_FALLBACK_MODEL', '');
      if (!fallback || fallback === model || err?.code === 'NO_KEY_AVAILABLE') throw err;
      logger.warn(`[llm] ${model} lỗi (${String(err.message).slice(0, 120)}), thử mô hình dự phòng ${fallback}`);
      const res = await geminiAttempt(fallback, opts, true);
      return { ...res, model: fallback, provider: 'GEMINI', fallbackUsed: true };
    }
  }

  /** Vector đã chuẩn hóa độ dài 1 -> cosine = tích vô hướng (rẻ khi tính trong Node). */
  async function embed(texts, taskType = 'RETRIEVAL_DOCUMENT') {
    const out = [];
    for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
      const batch = texts.slice(i, i + EMBED_BATCH_SIZE);
      const model = cfg('EMBEDDING_MODEL', 'gemini-embedding-001');
      const started = Date.now();
      let label = null;
      // Ước lượng token vào (API vector không trả usage): ~4 ký tự / token.
      const estTokens = Math.ceil(batch.reduce((s, x) => s + String(x).length, 0) / 4);
      let vectors;
      try {
        vectors = await pool.run((key, entry) => { label = entry?.label || null; return transport.embed(key, { model, texts: batch, dim: cfg('EMBEDDING_DIM', 768), taskType }); });
        meter?.record({ provider: 'GEMINI', task: 'EMBED', model, keyLabel: label, ok: true, latencyMs: Date.now() - started, tokensIn: estTokens });
      } catch (err) {
        meter?.record({ provider: 'GEMINI', task: 'EMBED', model, keyLabel: label, ok: false, latencyMs: Date.now() - started, errorKind: err?.code === 'NO_KEY_AVAILABLE' ? 'NO_KEY' : classifyError(err) });
        throw err;
      }
      out.push(...vectors.map(normalizeVector));
    }
    return out;
  }

  /** Thử MỘT khóa với mô hình đang cấu hình (không qua pool, không đánh dấu nghỉ). Khóa "gsk_…" là Groq. */
  async function testKey(apiKey, { model } = {}) {
    if (groq && isGroqKey(apiKey)) return groq.testKey(apiKey, model ? { model } : {});
    model = model || cfg('LLM_MODEL', 'gemini-2.5-flash');
    const started = Date.now();
    try {
      const res = await transport.generate(apiKey, {
        ...request(model, { system: 'Bạn là công cụ kiểm tra kết nối.', contents: [{ role: 'user', parts: [{ text: TEST_PROMPT }] }], maxTokens: 20 }),
        temperature: 0,
      });
      meter?.record({ provider: 'GEMINI', task: 'TEST', model, ok: true, latencyMs: Date.now() - started, tokensIn: res.tokensIn, tokensOut: res.tokensOut });
      return { ok: true, latencyMs: Date.now() - started, model, message: `Kết nối tốt (${Date.now() - started} ms)`, reply: String(res.text || '').slice(0, 40) };
    } catch (err) {
      meter?.record({ provider: 'GEMINI', task: 'TEST', model, ok: false, latencyMs: Date.now() - started, errorKind: classifyError(err) });
      return { ok: false, latencyMs: Date.now() - started, model, message: describeLlmError(err) };
    }
  }

  /** Thử mọi khóa đang có trong pool. */
  async function testAll() {
    const out = [];
    for (const e of pool.entries()) out.push({ label: e.label, id: e.id, source: e.source, provider: 'GEMINI', ...(await testKey(e.key)) });
    for (const e of groq ? groq.entries() : []) out.push({ label: e.label, id: e.id, source: e.source, provider: 'GROQ', ...(await groq.testKey(e.key)) });
    return out;
  }

  return {
    available, enabled, generate, embed, setKeys, testKey, testAll,
    geminiAvailable, groqAvailable,
    /** Nạp lại khóa Groq do Admin thêm trên giao diện. */
    setGroqKeys: (keys) => (groq ? groq.setKeys(keys) : 0),
    keyStatus: () => [...pool.status().map((s) => ({ ...s, provider: 'GEMINI' })), ...(groq ? groq.keyStatus() : [])],
    /** Giá trị khóa thật – CHỈ để bộ lọc bảo mật xóa khỏi câu trả lời nếu bị lộ. */
    secretValues: () => [...pool.entries().map((e) => e.key), ...(groq ? groq.secretValues() : [])],
    keyCount: () => pool.size + (groq ? groq.size() : 0),
    providerFor,
    meter,
    providers: () => ({ chat: providerFor('CHAT'), recommend: providerFor('RECOMMEND'), analytics: providerFor('ANALYTICS'), gemini: geminiAvailable(), groq: groqAvailable(), geminiKeys: pool.size, groqKeys: groq ? groq.size() : 0 }),
    modelName: () => cfg('EMBEDDING_MODEL', 'gemini-embedding-001'),
  };
}

function normalizeVector(v) {
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm) || 1;
  return v.map((x) => x / norm);
}

function dot(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let s = 0;
  for (let i = 0; i < a.length; i += 1) s += a[i] * b[i];
  return s;
}

module.exports = { createLlmClient, createGeminiTransport, describeLlmError, normalizeVector, dot, extractWebSources };
