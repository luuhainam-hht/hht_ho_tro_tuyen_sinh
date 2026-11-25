'use strict';
/**
 * Cửa ngõ duy nhất tới LLM: sinh câu (generate) và tạo vector (embed) qua key pool, đếm token.
 * Mọi tham số (model, model dự phòng, nhiệt độ, thời gian chờ, bật/tắt) đọc từ system_configs MỖI lần gọi
 * -> Admin đổi trên giao diện có hiệu lực ngay, không sửa mã, không khởi động lại.
 * Danh sách khóa nạp lại được (setKeys) khi Admin thêm/xóa khóa API.
 * transport có thể thay (test dùng bản giả; đổi nhà cung cấp chỉ viết transport mới).
 *
 * Phân việc giữa hai nhà cung cấp (Admin chọn trên trang Cài đặt AI):
 *  Ba nhà cung cấp sinh câu trả lời: Groq, Gemini, Mindtek (bot.mindtek.ai, gọi ngầm – giao diện chat vẫn của HHT).
 *  - CHAT (trả lời thí sinh)      : AI_PROVIDER_CHAT      (mặc định BALANCE)
 *  - RECOMMEND (gợi ý ngành)      : AI_PROVIDER_RECOMMEND (mặc định GROQ, mô hình nhỏ GROQ_SMALL_MODEL)
 *  - ANALYTICS (phân tích Tổng quan): AI_PROVIDER_ANALYTICS (mặc định GEMINI)
 *    Giá trị BALANCE | AUTO | GROQ | GEMINI | MINDTEK. BALANCE = chia đều tải cho mọi bên đang dùng được: mỗi câu đi bên
 *    dùng ít token hôm nay nhất (theo % ngân sách riêng nếu mọi bên có đặt), bằng nhau thì xoay vòng.
 *    AUTO = Groq → Gemini → Mindtek. Lỗi / hết ngân sách riêng -> tự chuyển lần lượt sang các bên còn lại.
 *  - WEB_SEARCH (tra Google), OCR (đọc ảnh/PDF scan), EMBED (vector): chỉ Gemini làm được.
 * Mỗi lần gọi được ghi vào ai_calls (aiUsageMeter) để thống kê, tính ngân sách và chi phí.
 */
const { createGeminiKeyPool, classifyError } = require('./geminiKeyPool');
const { isGroqKey } = require('./groqClient');

const DEFAULT_TIMEOUT_MS = 20_000;
const GEMINI_API_VERSION = 'v1beta';
const GEMINI_BASE = `https://generativelanguage.googleapis.com/${GEMINI_API_VERSION}`;
const EMBED_BATCH_SIZE = 50;
const TEST_PROMPT = 'Trả lời đúng một từ: OK';

/**
 * Gọi Gemini API trực tiếp qua REST v1beta (không qua thư viện @google/genai): thư viện 3.x mặc định gọi v1,
 * bản này từ chối systemInstruction ("Developer instruction is not enabled for api version v1") và không có
 * Google Search. Gọi REST thì không phụ thuộc phiên bản thư viện cài trên máy chủ.
 */
function createGeminiTransport({ fetchImpl = globalThis.fetch } = {}) {
  async function call(apiKey, path, body, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(`${GEMINI_BASE}/${path}`, {
        method: 'POST', signal: controller.signal,
        headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const e = data?.error || {};
        const err = new Error(`Gemini ${res.status} ${e.status || ''}: ${e.message || res.statusText}`.trim());
        err.status = res.status;
        throw err;
      }
      return data;
    } finally {
      clearTimeout(timer);
    }
  }
  const modelPath = (m) => `models/${String(m).replace(/^models\//, '')}`;
  return {
    async generate(apiKey, { model, system, contents, temperature, maxTokens, json, search = false, timeoutMs = DEFAULT_TIMEOUT_MS }) {
      const generationConfig = { temperature, maxOutputTokens: maxTokens };
      // Google Search grounding không dùng chung được với đầu ra JSON -> hai chế độ tách biệt.
      if (json && !search) generationConfig.responseMimeType = 'application/json';
      // Gemini 2.5 Flash/Flash-Lite: tắt "suy nghĩ" để token suy nghĩ không ăn hết giới hạn đầu ra và trả lời nhanh hơn.
      if (/gemini-2\.5-flash/i.test(model)) generationConfig.thinkingConfig = { thinkingBudget: 0 };
      const body = {
        contents, generationConfig,
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        ...(search ? { tools: [{ google_search: {} }] } : {}),
      };
      const data = await call(apiKey, `${modelPath(model)}:generateContent`, body, timeoutMs);
      const cand = data?.candidates?.[0];
      const text = (cand?.content?.parts || []).filter((x) => typeof x.text === 'string' && !x.thought).map((x) => x.text).join('').trim();
      if (!text && cand?.finishReason && cand.finishReason !== 'STOP') {
        const err = new Error(`Gemini không trả nội dung (finishReason=${cand.finishReason})`);
        err.status = 400;
        throw err;
      }
      const usage = data?.usageMetadata || {};
      const out = { text, tokensIn: usage.promptTokenCount || 0, tokensOut: (usage.candidatesTokenCount || 0) + (usage.thoughtsTokenCount || 0) };
      if (search) {
        out.webSources = extractWebSources(data);
        out.webSupports = extractWebSupports(data);
      }
      return out;
    },
    async embed(apiKey, { model, texts, dim, taskType }) {
      const data = await call(apiKey, `${modelPath(model)}:batchEmbedContents`, {
        requests: texts.map((t) => ({ model: modelPath(model), content: { parts: [{ text: String(t) }] }, taskType, outputDimensionality: dim })),
      }, 60_000);
      return (data.embeddings || []).map((e) => e.values);
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

/**
 * Đoạn câu trả lời được Google xác nhận có nguồn (groundingSupports): [{ text, sources: [{ title, url }] }].
 * Dùng để kiểm tra con số trong câu trả lời Internet: con số chỉ được giữ khi nằm trong đoạn có nguồn tin cậy.
 */
function extractWebSupports(res) {
  const meta = res?.candidates?.[0]?.groundingMetadata || {};
  const chunks = meta.groundingChunks || [];
  return (meta.groundingSupports || [])
    .map((s) => ({
      text: String(s?.segment?.text || '').trim(),
      sources: (s?.groundingChunkIndices || [])
        .map((i) => chunks[i]?.web)
        .filter((w) => w?.uri)
        .map((w) => ({ title: String(w.title || w.uri).slice(0, 200), url: w.uri })),
    }))
    .filter((s) => s.text && s.sources.length);
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
const TASK_DEFAULT = { CHAT: 'BALANCE', RECOMMEND: 'BALANCE', ANALYTICS: 'GEMINI' };
/** Thứ tự ưu tiên khi AUTO và thứ tự dự phòng: Groq (nhanh) → Gemini → Mindtek. */
const CHAT_PROVIDERS = ['GROQ', 'GEMINI', 'MINDTEK'];
const PROVIDER_LABEL = { GROQ: 'Groq', GEMINI: 'Gemini', MINDTEK: 'Mindtek' };
const ROUTE_VALUES = ['BALANCE', 'AUTO', ...CHAT_PROVIDERS];

function createLlmClient({ apiKeys = [], configService, transport = createGeminiTransport(), logger = console, groq = null, meter = null, mindtek = null }) {
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
  const mindtekAvailable = () => enabled() && Boolean(mindtek?.available());
  const isAvailable = { GROQ: groqAvailable, GEMINI: geminiAvailable, MINDTEK: mindtekAvailable };
  /** Có ít nhất một nhà cung cấp sinh câu trả lời. */
  const available = () => geminiAvailable() || groqAvailable() || mindtekAvailable();
  /** Nhà cung cấp chính đã cấu hình cho một việc: BALANCE | AUTO | GROQ | GEMINI | MINDTEK. */
  const providerFor = (task) => {
    const v = String(cfg(TASK_PROVIDER_KEY[task], TASK_DEFAULT[task] || 'GEMINI') || 'AUTO').toUpperCase();
    return ROUTE_VALUES.includes(v) ? v : 'BALANCE';
  };
  let turn = 0;
  /**
   * Chia đều: chọn bên đang "nhẹ tải" nhất hôm nay trong các bên dùng được
   * (theo % ngân sách riêng nếu mọi bên đều đặt ngân sách, không thì theo số token). Ngang nhau -> xoay vòng.
   */
  async function pickBalanced(cands) {
    turn += 1;
    const rr = cands[(turn - 1) % cands.length];
    if (!meter?.tokensToday) return rr;
    try {
      const used = await Promise.all(cands.map((p) => meter.tokensToday(p)));
      const budgets = cands.map((p) => Number(cfg(`${p}_DAILY_TOKEN_BUDGET`, 0)) || 0);
      const load = budgets.every(Boolean) ? used.map((u, i) => u / budgets[i]) : used;
      const min = Math.min(...load);
      const max = Math.max(...load);
      if (!max || (max - min) / max < 0.02) return rr;
      return cands[load.indexOf(min)];
    } catch {
      return rr;
    }
  }
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
    if (geminiOnly) {
      if (geminiAvailable() && !(await inBudget('GEMINI'))) throw budgetError('GEMINI');
      return viaGemini(opts, false);
    }

    const budgets = await Promise.all(CHAT_PROVIDERS.map(inBudget));
    const can = CHAT_PROVIDERS.filter((p, i) => isAvailable[p]() && budgets[i]);
    if (!can.length) {
      const over = CHAT_PROVIDERS.find((p, i) => isAvailable[p]() && !budgets[i]);
      if (over) throw budgetError(over);
      return viaGemini(opts, false); // không bên nào dùng được -> Gemini ném lỗi "không còn khóa" như trước
    }
    const pref = providerFor(t);
    let first;
    if (pref === 'BALANCE') first = can.length > 1 ? await pickBalanced(can) : can[0];
    else first = can.includes(pref) ? pref : can[0]; // AUTO = theo thứ tự Groq → Gemini → Mindtek
    const order = [first, ...can.filter((p) => p !== first)];

    const call = (p, crossFallback) => {
      if (p === 'GROQ') return groq.generate({ system, history, prompt, json, maxTokens, timeoutMs, temperature, task: t, small: t === 'RECOMMEND', crossFallback });
      if (p === 'MINDTEK') return mindtek.generate({ system, history, prompt, json, task: t, crossFallback });
      return viaGemini(opts, crossFallback);
    };
    let lastErr;
    for (let i = 0; i < order.length; i += 1) {
      try {
        return await call(order[i], i > 0);
      } catch (err) {
        lastErr = err;
        if (i < order.length - 1) logger.warn(`[llm] ${PROVIDER_LABEL[order[i]]} lỗi (${String(err.message).slice(0, 120)}), chuyển sang ${PROVIDER_LABEL[order[i + 1]]}`);
      }
    }
    throw lastErr;
  }

  function budgetError(provider) {
    const err = new Error(`${PROVIDER_LABEL[provider] || provider} đã dùng hết ngân sách token hôm nay`);
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
    if (mindtek?.configured()) out.push({ label: 'Mindtek', id: 'mindtek', source: 'CONFIG', ...(await mindtek.test()) });
    return out;
  }

  return {
    available, enabled, generate, embed, setKeys, testKey, testAll,
    geminiAvailable, groqAvailable, mindtekAvailable,
    /** Kiểm tra kết nối Mindtek (trang Cài đặt AI). */
    testMindtek: () => (mindtek ? mindtek.test() : Promise.resolve({ ok: false, provider: 'MINDTEK', message: 'Chưa cấu hình Mindtek' })),
    /** Nạp lại khóa Groq do Admin thêm trên giao diện. */
    setGroqKeys: (keys) => (groq ? groq.setKeys(keys) : 0),
    keyStatus: () => [...pool.status().map((s) => ({ ...s, provider: 'GEMINI' })), ...(groq ? groq.keyStatus() : []), ...(mindtek ? mindtek.status() : [])],
    /** Giá trị khóa thật – CHỈ để bộ lọc bảo mật xóa khỏi câu trả lời nếu bị lộ. */
    secretValues: () => [...pool.entries().map((e) => e.key), ...(groq ? groq.secretValues() : [])],
    keyCount: () => pool.size + (groq ? groq.size() : 0) + (mindtek?.configured() ? 1 : 0),
    providerFor,
    meter,
    providers: () => ({ chat: providerFor('CHAT'), recommend: providerFor('RECOMMEND'), analytics: providerFor('ANALYTICS'), gemini: geminiAvailable(), groq: groqAvailable(), mindtek: mindtekAvailable(), mindtekConfigured: Boolean(mindtek?.configured()), geminiKeys: pool.size, groqKeys: groq ? groq.size() : 0 }),
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

module.exports = { CHAT_PROVIDERS, ROUTE_VALUES, GEMINI_API_VERSION, createLlmClient, createGeminiTransport, describeLlmError, normalizeVector, dot, extractWebSources, extractWebSupports };
