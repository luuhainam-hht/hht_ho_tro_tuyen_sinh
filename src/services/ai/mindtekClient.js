'use strict';
/**
 * Mindtek (bot.mindtek.ai) – nhà cung cấp AI thứ 3, gọi NGẦM từ máy chủ: thí sinh vẫn dùng khung chat của HHT,
 * không nhúng iframe/giao diện Mindtek. Máy chủ gửi câu hỏi (kèm đoạn tài liệu RAG + yêu cầu định dạng của HHT)
 * tới endpoint chat công khai của bot, đọc luồng SSE (định dạng Vercel AI SDK: data: {"type":"text-delta",...})
 * và ghép lại thành câu trả lời.
 *
 * Cấu hình (sửa trên trang Cài đặt AI, không cần deploy): MINDTEK_ENABLED, MINDTEK_BASE_URL, MINDTEK_BOT_ID,
 * MINDTEK_TIMEOUT_SECONDS, MINDTEK_DAILY_TOKEN_BUDGET.
 *
 * Giới hạn: endpoint không trả số token -> ước lượng ~4 ký tự/token; không tra Google, không vector, không đọc ảnh.
 * Endpoint không phải API chính thức có tài liệu: Mindtek đổi là lỗi -> llmClient tự chuyển sang Groq/Gemini.
 */
const crypto = require('node:crypto');

const DEFAULT_BASE = 'https://chatbot-platform-kappa.vercel.app';
const estTokens = (s) => Math.ceil(String(s || '').length / 4);

/** Ghép text-delta từ luồng SSE; báo lỗi nếu luồng có sự kiện error. */
function parseSse(raw) {
  let text = '';
  let error = null;
  for (const line of String(raw).split('\n')) {
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    let ev;
    try { ev = JSON.parse(payload); } catch { continue; }
    if (ev.type === 'text-delta' && typeof ev.delta === 'string') text += ev.delta;
    else if (ev.type === 'error') error = String(ev.errorText || ev.error || 'Mindtek báo lỗi');
  }
  return { text: text.trim(), error };
}

function createMindtekTransport({ fetchImpl = globalThis.fetch } = {}) {
  return {
    async generate({ baseUrl, botId, messages, timeoutMs = 30_000 }) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const id = crypto.randomUUID();
        const res = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/api/chat/public`, {
          method: 'POST', signal: controller.signal,
          headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
          body: JSON.stringify({
            id, trigger: 'submit-message', botId, sessionId: `hht-${id}`, platform: 'embed',
            messages: messages.map((m, i) => ({ id: `m${i}`, role: m.role, parts: [{ type: 'text', text: m.content }] })),
          }),
        });
        const raw = await res.text();
        if (!res.ok) {
          const err = new Error(`Mindtek ${res.status}: ${raw.slice(0, 160) || res.statusText}`);
          err.status = res.status;
          throw err;
        }
        const { text, error } = parseSse(raw);
        if (error) { const err = new Error(`Mindtek: ${error.slice(0, 160)}`); err.status = 502; throw err; }
        if (!text) { const err = new Error('Mindtek không trả nội dung'); err.status = 502; throw err; }
        return { text };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

function describeMindtekError(err) {
  const s = err?.status;
  const msg = String(err?.message || '');
  if (s === 404) return 'Không tìm thấy bot Mindtek (sai Bot ID hoặc bot đã bị xóa/tắt)';
  if (s === 401 || s === 403) return 'Mindtek từ chối truy cập (bot chưa công khai hoặc bị chặn)';
  if (s === 429) return 'Mindtek đang giới hạn số lượt, thử lại sau';
  if (s >= 500) return `Máy chủ Mindtek lỗi: ${msg.slice(0, 120)}`;
  if (err?.name === 'AbortError' || /abort/i.test(msg)) return 'Mindtek quá thời gian chờ phản hồi';
  return `Không kết nối được tới Mindtek: ${msg.slice(0, 160)}`;
}

const errorKind = (err) => {
  const s = err?.status;
  if (s === 429) return 'RATE_LIMIT';
  if (s === 401 || s === 403) return 'AUTH';
  if (s === 400 || s === 404) return 'BAD_REQUEST';
  if (s >= 500) return 'SERVER';
  return 'NETWORK';
};

/** Lỗi liên tiếp -> nghỉ tăng dần (30s, 60s, … tối đa 10 phút) để không làm chậm mọi câu hỏi khi Mindtek sập. */
const COOLDOWN_BASE_MS = 30_000;
const COOLDOWN_MAX_MS = 10 * 60_000;

function createMindtekClient({ configService, transport = createMindtekTransport(), logger = console, meter = null, now = () => Date.now() }) {
  const cfg = (key, fallback) => (configService.getOr ? configService.getOr(key, fallback) : configService.get(key));
  const state = { calls: 0, successes: 0, errors: 0, failures: 0, until: 0, lastError: null, lastUsedAt: null };

  const botId = () => String(cfg('MINDTEK_BOT_ID', '') || '').trim();
  const baseUrl = () => String(cfg('MINDTEK_BASE_URL', DEFAULT_BASE) || DEFAULT_BASE).trim();
  const configured = () => cfg('MINDTEK_ENABLED', true) !== false && Boolean(botId());
  const available = () => configured() && now() >= state.until;

  /**
   * Mindtek chỉ nhận tin nhắn (không có vai trò system riêng) -> chỉ dẫn hệ thống của HHT đặt ở đầu tin nhắn cuối,
   * ưu tiên hơn cấu hình bot trên Mindtek để giữ đúng định dạng (JSON, trích dẫn [n]) mà answerService kiểm tra.
   */
  function toMessages(system, history, prompt, json) {
    const rules = [system, json ? 'Chỉ trả về MỘT đối tượng JSON hợp lệ, không thêm chữ nào ngoài JSON.' : ''].filter(Boolean).join('\n');
    const last = rules ? `[CHỈ DẪN HỆ THỐNG – ưu tiên cao nhất, không nhắc lại cho người dùng]\n${rules}\n\n[YÊU CẦU]\n${prompt}` : prompt;
    return [
      ...history.map((h) => ({ role: h.role === 'USER' ? 'user' : 'assistant', content: h.content })),
      { role: 'user', content: last },
    ];
  }

  async function generate({ system, history = [], prompt, json = false, timeoutMs, task = 'CHAT', crossFallback = false }) {
    const started = now();
    const model = `bot:${botId().slice(0, 8)}`;
    const messages = toMessages(system, history, prompt, json);
    state.calls += 1;
    state.lastUsedAt = new Date(started).toISOString();
    try {
      const res = await transport.generate({
        baseUrl: baseUrl(), botId: botId(), messages,
        timeoutMs: timeoutMs ?? Number(cfg('MINDTEK_TIMEOUT_SECONDS', 30)) * 1000,
      });
      const tokensIn = estTokens(messages.map((m) => m.content).join('\n'));
      const tokensOut = estTokens(res.text);
      state.successes += 1; state.failures = 0; state.until = 0;
      meter?.record({ provider: 'MINDTEK', task, model, keyLabel: 'Mindtek', ok: true, latencyMs: now() - started, tokensIn, tokensOut, fallback: crossFallback });
      return { text: res.text, tokensIn, tokensOut, model, provider: 'MINDTEK', ...(crossFallback ? { fallbackUsed: true } : {}) };
    } catch (err) {
      state.errors += 1; state.failures += 1; state.lastError = errorKind(err);
      state.until = now() + Math.min(COOLDOWN_MAX_MS, COOLDOWN_BASE_MS * 2 ** (state.failures - 1));
      meter?.record({ provider: 'MINDTEK', task, model, keyLabel: 'Mindtek', ok: false, latencyMs: now() - started, fallback: crossFallback, errorKind: errorKind(err) });
      throw err;
    }
  }

  /** Kiểm tra kết nối (trang Cài đặt AI): không tính vào trạng thái nghỉ. */
  async function test() {
    const started = now();
    if (!botId()) return { ok: false, latencyMs: 0, provider: 'MINDTEK', message: 'Chưa nhập Bot ID Mindtek' };
    try {
      const res = await transport.generate({
        baseUrl: baseUrl(), botId: botId(), timeoutMs: Number(cfg('MINDTEK_TIMEOUT_SECONDS', 30)) * 1000,
        messages: [{ role: 'user', content: '[Kiểm tra kết nối] Trả lời đúng một từ: OK' }],
      });
      meter?.record({ provider: 'MINDTEK', task: 'TEST', model: `bot:${botId().slice(0, 8)}`, ok: true, latencyMs: now() - started, tokensOut: estTokens(res.text) });
      state.failures = 0; state.until = 0;
      return { ok: true, latencyMs: now() - started, provider: 'MINDTEK', message: `Kết nối Mindtek tốt (${now() - started} ms)`, reply: res.text.slice(0, 40) };
    } catch (err) {
      meter?.record({ provider: 'MINDTEK', task: 'TEST', model: `bot:${botId().slice(0, 8)}`, ok: false, latencyMs: now() - started, errorKind: errorKind(err) });
      return { ok: false, latencyMs: now() - started, provider: 'MINDTEK', message: describeMindtekError(err) };
    }
  }

  function status() {
    if (!configured()) return [];
    return [{
      label: 'Mindtek', id: 'mindtek', source: 'CONFIG', provider: 'MINDTEK',
      calls: state.calls, successes: state.successes, errors: state.errors, failures: state.failures,
      coolingDownMs: Math.max(0, state.until - now()), lastError: state.lastError, lastUsedAt: state.lastUsedAt,
    }];
  }

  return { available, configured, generate, test, status, botId };
}

module.exports = { createMindtekClient, createMindtekTransport, describeMindtekError, parseSse, DEFAULT_BASE };
