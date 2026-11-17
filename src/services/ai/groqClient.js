'use strict';
/**
 * Groq (API tương thích OpenAI, suy luận rất nhanh) – dùng cho phần SINH CÂU TRẢ LỜI của trợ lý và phần
 * AI phân tích ở trang Tổng quan. Groq không có Google Search, vector (embedding) hay đọc ảnh/PDF, nên các
 * việc đó vẫn do Gemini làm (llmClient tự định tuyến).
 *
 * Khóa: GROQ_API_KEYS trong .env (nhiều khóa cách nhau dấu phẩy) hoặc thêm trên trang Cài đặt AI
 * (khóa bắt đầu bằng "gsk_"). Dùng chung cơ chế xoay vòng/nghỉ theo loại lỗi với Gemini.
 * Mô hình đọc từ cấu hình GROQ_MODEL / GROQ_FALLBACK_MODEL mỗi lần gọi -> Admin đổi trên giao diện khi
 * Groq ngừng một mô hình, không cần sửa mã.
 */
const { createGeminiKeyPool, classifyError } = require('./geminiKeyPool');

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const DEFAULT_MODEL = 'openai/gpt-oss-120b';
const DEFAULT_FALLBACK = 'openai/gpt-oss-20b';
const DEFAULT_SMALL = 'openai/gpt-oss-20b';
/** Mô hình "suy luận" của Groq: token suy nghĩ tính vào giới hạn đầu ra -> cần thêm chỗ, giữ mức suy luận thấp cho nhanh. */
const isReasoningModel = (m) => /gpt-oss|qwen3|deepseek-r1/i.test(m);
const REASONING_HEADROOM = 1536;

function createGroqTransport({ fetchImpl = globalThis.fetch } = {}) {
  return {
    async generate(apiKey, { model, messages, temperature, maxTokens, json, timeoutMs = 20_000 }) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const body = {
          model, messages, temperature,
          max_completion_tokens: isReasoningModel(model) ? maxTokens + REASONING_HEADROOM : maxTokens,
          ...(json ? { response_format: { type: 'json_object' } } : {}),
          ...(isReasoningModel(model) && /gpt-oss/i.test(model) ? { reasoning_effort: 'low', include_reasoning: false } : {}),
        };
        const res = await fetchImpl(GROQ_URL, {
          method: 'POST', signal: controller.signal,
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          const err = new Error(`Groq ${res.status}: ${data?.error?.message || res.statusText}`);
          err.status = res.status;
          throw err;
        }
        const text = String(data?.choices?.[0]?.message?.content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
        return { text, tokensIn: data?.usage?.prompt_tokens || 0, tokensOut: data?.usage?.completion_tokens || 0 };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/** Lỗi Groq -> câu tiếng Việt cho trang Cài đặt AI. */
function describeGroqError(err) {
  const s = err?.status;
  const msg = String(err?.message || '');
  if (s === 401 || s === 403) return 'Khóa Groq sai hoặc đã bị thu hồi';
  if (s === 404 || /model.*(not exist|not found|decommissioned)/i.test(msg)) return 'Groq không có mô hình này (đã ngừng hoặc sai tên) – đổi "Mô hình Groq" trong Cài đặt AI';
  if (s === 429) return 'Khóa Groq hết hạn mức hoặc gọi quá nhanh, thử lại sau';
  if (s === 400) return `Yêu cầu không hợp lệ: ${msg.slice(0, 160)}`;
  if (s >= 500) return 'Máy chủ Groq đang lỗi tạm thời';
  if (err?.name === 'AbortError' || /abort/i.test(msg)) return 'Quá thời gian chờ phản hồi';
  return `Không kết nối được tới Groq: ${msg.slice(0, 160)}`;
}

function createGroqClient({ apiKeys = [], configService, transport = createGroqTransport(), logger = console, meter = null }) {
  const envKeys = apiKeys.map((key, i) => ({ key, label: `Groq .env #${i + 1}`, source: 'ENV' }));
  let pool = createGeminiKeyPool(envKeys, { logger });
  const cfg = (key, fallback) => (configService.getOr ? configService.getOr(key, fallback) : configService.get(key));

  function setKeys(extraKeys = []) {
    pool = createGeminiKeyPool([...envKeys, ...extraKeys], { logger, state: pool.exportState() });
    return pool.size;
  }
  const available = () => pool.size > 0 && pool.available() > 0;

  function toMessages(system, history, prompt) {
    return [
      ...(system ? [{ role: 'system', content: system }] : []),
      ...history.map((h) => ({ role: h.role === 'USER' ? 'user' : 'assistant', content: h.content })),
      { role: 'user', content: prompt },
    ];
  }

  /** Một lần gọi một mô hình (qua pool khóa) + ghi đồng hồ đo. */
  async function attempt(model, req, { task, fallback }) {
    const started = Date.now();
    let label = null;
    try {
      const res = await pool.run((key, entry) => { label = entry?.label || null; return transport.generate(key, req(model)); });
      meter?.record({ provider: 'GROQ', task, model, keyLabel: label, ok: true, latencyMs: Date.now() - started, tokensIn: res.tokensIn, tokensOut: res.tokensOut, fallback });
      return res;
    } catch (err) {
      meter?.record({ provider: 'GROQ', task, model, keyLabel: label, ok: false, latencyMs: Date.now() - started, fallback, errorKind: err?.code === 'NO_KEY_AVAILABLE' ? 'NO_KEY' : classifyError(err) });
      throw err;
    }
  }

  /**
   * task: CHAT | RECOMMEND | ANALYTICS… (thống kê). small: dùng GROQ_SMALL_MODEL (việc nhỏ).
   * crossFallback: lần gọi này là do Gemini lỗi chuyển sang (đánh dấu "tự chuyển bên").
   */
  async function generate({ system, history = [], prompt, json = false, maxTokens, timeoutMs, temperature, task = 'CHAT', small = false, crossFallback = false }) {
    // Chế độ JSON của Groq bắt buộc lời nhắc có chữ "JSON".
    const sys = json && !/json/i.test(`${system} ${prompt}`) ? `${system || ''}\nChỉ trả về một đối tượng JSON hợp lệ.` : system;
    const req = (model) => ({
      model, messages: toMessages(sys, history, prompt), json,
      temperature: temperature ?? cfg('LLM_TEMPERATURE', 0.2),
      maxTokens: maxTokens ?? cfg('MAX_ANSWER_TOKENS', 800),
      timeoutMs: timeoutMs ?? cfg('LLM_TIMEOUT_SECONDS', 20) * 1000,
    });
    const main = cfg('GROQ_MODEL', DEFAULT_MODEL);
    const model = small ? (cfg('GROQ_SMALL_MODEL', DEFAULT_SMALL) || main) : main;
    try {
      return { ...(await attempt(model, req, { task, fallback: crossFallback })), model, provider: 'GROQ', ...(crossFallback ? { fallbackUsed: true } : {}) };
    } catch (err) {
      const fallback = small && model !== main ? main : cfg('GROQ_FALLBACK_MODEL', DEFAULT_FALLBACK);
      if (!fallback || fallback === model || err?.code === 'NO_KEY_AVAILABLE') throw err;
      logger.warn(`[groq] ${model} lỗi (${String(err.message).slice(0, 120)}), thử ${fallback}`);
      return { ...(await attempt(fallback, req, { task, fallback: true })), model: fallback, provider: 'GROQ', fallbackUsed: true };
    }
  }

  async function testKey(apiKey, { model = cfg('GROQ_MODEL', DEFAULT_MODEL) } = {}) {
    const started = Date.now();
    try {
      const res = await transport.generate(apiKey, {
        model, messages: [{ role: 'system', content: 'Bạn là công cụ kiểm tra kết nối.' }, { role: 'user', content: 'Trả lời đúng một từ: OK' }],
        temperature: 0, maxTokens: 20, timeoutMs: cfg('LLM_TIMEOUT_SECONDS', 20) * 1000,
      });
      meter?.record({ provider: 'GROQ', task: 'TEST', model, ok: true, latencyMs: Date.now() - started, tokensIn: res.tokensIn, tokensOut: res.tokensOut });
      return { ok: true, latencyMs: Date.now() - started, model, provider: 'GROQ', message: `Kết nối Groq tốt (${Date.now() - started} ms)`, reply: String(res.text || '').slice(0, 40) };
    } catch (err) {
      meter?.record({ provider: 'GROQ', task: 'TEST', model, ok: false, latencyMs: Date.now() - started, errorKind: classifyError(err) });
      return { ok: false, latencyMs: Date.now() - started, model, provider: 'GROQ', message: describeGroqError(err) };
    }
  }

  return {
    available, generate, setKeys, testKey,
    size: () => pool.size,
    keyStatus: () => pool.status().map((s) => ({ ...s, provider: 'GROQ' })),
    entries: () => pool.entries(),
    secretValues: () => pool.entries().map((e) => e.key),
  };
}

const isGroqKey = (k) => /^gsk_/.test(String(k || '').trim());

module.exports = { createGroqClient, createGroqTransport, describeGroqError, isGroqKey, DEFAULT_MODEL, DEFAULT_FALLBACK, DEFAULT_SMALL };
