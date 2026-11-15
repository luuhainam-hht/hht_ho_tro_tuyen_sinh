'use strict';
/**
 * Cửa ngõ duy nhất tới LLM: sinh câu (generate) và tạo vector (embed) qua key pool, đếm token.
 * Mọi tham số (model, model dự phòng, nhiệt độ, thời gian chờ, bật/tắt) đọc từ system_configs MỖI lần gọi
 * -> Admin đổi trên giao diện có hiệu lực ngay, không sửa mã, không khởi động lại.
 * Danh sách khóa nạp lại được (setKeys) khi Admin thêm/xóa khóa API.
 * transport có thể thay (test dùng bản giả; đổi nhà cung cấp chỉ viết transport mới).
 */
const { GoogleGenAI } = require('@google/genai');
const { createGeminiKeyPool, classifyError } = require('./geminiKeyPool');

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
    async generate(apiKey, { model, system, contents, temperature, maxTokens, json, timeoutMs = DEFAULT_TIMEOUT_MS }) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await client(apiKey).models.generateContent({
          model,
          contents,
          config: {
            systemInstruction: system, temperature, maxOutputTokens: maxTokens, abortSignal: controller.signal,
            ...(json ? { responseMimeType: 'application/json' } : {}),
          },
        });
        const usage = res.usageMetadata || {};
        return { text: (res.text || '').trim(), tokensIn: usage.promptTokenCount || 0, tokensOut: usage.candidatesTokenCount || 0 };
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

function createLlmClient({ apiKeys = [], configService, transport = createGeminiTransport(), logger = console }) {
  const envKeys = apiKeys.map((key, i) => ({ key, label: `.env #${i + 1}`, source: 'ENV' }));
  let pool = createGeminiKeyPool(envKeys, { logger });
  const cfg = (key, fallback) => (configService.getOr ? configService.getOr(key, fallback) : configService.get(key));

  /** Nạp lại khóa: khóa .env + khóa Admin thêm (đã giải mã). Giữ trạng thái nghỉ của khóa cũ. */
  function setKeys(extraKeys = []) {
    pool = createGeminiKeyPool([...envKeys, ...extraKeys], { logger, state: pool.exportState() });
    return pool.size;
  }

  const enabled = () => cfg('AI_ENABLED', true) !== false;
  const available = () => enabled() && pool.size > 0 && pool.available() > 0;

  function request(model, { system, contents, json, maxTokens }) {
    return {
      model, system, contents, json,
      temperature: cfg('LLM_TEMPERATURE', 0.2),
      maxTokens: maxTokens ?? cfg('MAX_ANSWER_TOKENS', 800),
      timeoutMs: cfg('LLM_TIMEOUT_SECONDS', 20) * 1000,
    };
  }

  async function generate({ system, history = [], prompt, json = false, maxTokens }) {
    const contents = [
      ...history.map((h) => ({ role: h.role === 'USER' ? 'user' : 'model', parts: [{ text: h.content }] })),
      { role: 'user', parts: [{ text: prompt }] },
    ];
    const model = cfg('LLM_MODEL', 'gemini-2.5-flash');
    try {
      const res = await pool.run((key) => transport.generate(key, request(model, { system, contents, json, maxTokens })));
      return { ...res, model };
    } catch (err) {
      // Mô hình chính lỗi (sai tên, quá tải, mọi khóa đều nghỉ…) -> thử mô hình dự phòng một lần.
      const fallback = cfg('LLM_FALLBACK_MODEL', '');
      if (!fallback || fallback === model || err?.code === 'NO_KEY_AVAILABLE') throw err;
      logger.warn(`[llm] ${model} lỗi (${String(err.message).slice(0, 120)}), thử mô hình dự phòng ${fallback}`);
      const res = await pool.run((key) => transport.generate(key, request(fallback, { system, contents, json, maxTokens })));
      return { ...res, model: fallback, fallbackUsed: true };
    }
  }

  /** Vector đã chuẩn hóa độ dài 1 -> cosine = tích vô hướng (rẻ khi tính trong Node). */
  async function embed(texts, taskType = 'RETRIEVAL_DOCUMENT') {
    const out = [];
    for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
      const batch = texts.slice(i, i + EMBED_BATCH_SIZE);
      const vectors = await pool.run((key) => transport.embed(key, {
        model: cfg('EMBEDDING_MODEL', 'gemini-embedding-001'), texts: batch, dim: cfg('EMBEDDING_DIM', 768), taskType,
      }));
      out.push(...vectors.map(normalizeVector));
    }
    return out;
  }

  /** Thử MỘT khóa với mô hình đang cấu hình (không qua pool, không đánh dấu nghỉ). */
  async function testKey(apiKey, { model = cfg('LLM_MODEL', 'gemini-2.5-flash') } = {}) {
    const started = Date.now();
    try {
      const res = await transport.generate(apiKey, {
        ...request(model, { system: 'Bạn là công cụ kiểm tra kết nối.', contents: [{ role: 'user', parts: [{ text: TEST_PROMPT }] }], maxTokens: 20 }),
        temperature: 0,
      });
      return { ok: true, latencyMs: Date.now() - started, model, message: `Kết nối tốt (${Date.now() - started} ms)`, reply: String(res.text || '').slice(0, 40) };
    } catch (err) {
      return { ok: false, latencyMs: Date.now() - started, model, message: describeLlmError(err) };
    }
  }

  /** Thử mọi khóa đang có trong pool. */
  async function testAll() {
    const out = [];
    for (const e of pool.entries()) out.push({ label: e.label, id: e.id, source: e.source, ...(await testKey(e.key)) });
    return out;
  }

  return {
    available, enabled, generate, embed, setKeys, testKey, testAll,
    keyStatus: () => pool.status(),
    keyCount: () => pool.size,
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

module.exports = { createLlmClient, createGeminiTransport, describeLlmError, normalizeVector, dot };
