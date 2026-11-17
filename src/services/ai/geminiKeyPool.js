'use strict';
/**
 * Kho nhiều API key xoay vòng, cooldown theo LOẠI lỗi (module thuần, dùng cho mọi LLM API).
 *   429/RESOURCE_EXHAUSTED -> nghỉ 60s (hoặc retryDelay Google trả về)
 *   401/403                -> nghỉ 1 giờ (key sai/bị thu hồi)
 *   5xx                    -> nghỉ 15s
 *   mạng/timeout           -> nghỉ 10s
 *   400/404 (lỗi yêu cầu, sai tên model) -> ném ngay, KHÔNG đổi key (đổi key cũng sai y như vậy)
 * Khóa là chuỗi hoặc { key, label, id, source }. Nạp lại danh sách (Admin thêm/xóa khóa) giữ nguyên
 * trạng thái nghỉ của khóa cũ qua tùy chọn state -> không "hồi sinh" khóa đang bị giới hạn.
 */
const KEY_COOLDOWN_MS = Object.freeze({ RATE_LIMIT: 60_000, AUTH: 3_600_000, SERVER: 15_000, NETWORK: 10_000 });

class NoKeyAvailableError extends Error {
  constructor() { super('Không còn API key khả dụng'); this.code = 'NO_KEY_AVAILABLE'; }
}

function statusOf(err) {
  const s = err?.status ?? err?.code ?? err?.response?.status;
  return typeof s === 'number' ? s : Number.parseInt(s, 10) || null;
}

function classifyError(err) {
  const status = statusOf(err);
  const msg = String(err?.message || '');
  if (status === 429 || /RESOURCE_EXHAUSTED|quota|rate limit/i.test(msg)) return 'RATE_LIMIT';
  if (status === 401 || status === 403 || /API key not valid|PERMISSION_DENIED|UNAUTHENTICATED/i.test(msg)) return 'AUTH';
  if (status === 400 || /INVALID_ARGUMENT/.test(msg)) return 'BAD_REQUEST';
  if (status === 404 || /NOT_FOUND|is not found/i.test(msg)) return 'BAD_REQUEST';
  if (status && status >= 500) return 'SERVER';
  return 'NETWORK';
}

/** "retryDelay":"37s" trong thông báo lỗi Gemini -> ms */
function retryDelayMs(err) {
  const m = /retryDelay"?\s*[:=]\s*"?(\d+(?:\.\d+)?)s/.exec(String(err?.message || ''));
  return m ? Math.ceil(Number(m[1]) * 1000) : null;
}

function createGeminiKeyPool(keys, { now = () => Date.now(), logger = console, state = new Map() } = {}) {
  const seen = new Set();
  const entries = [];
  keys.map((k) => (typeof k === 'string' ? { key: k } : k)).forEach((k) => {
    if (!k.key || seen.has(k.key)) return;
    seen.add(k.key);
    const prev = state.get(k.key);
    entries.push({
      key: k.key, label: k.label || `key#${entries.length + 1}`, id: k.id ?? null, source: k.source || 'ENV',
      cooldownUntil: prev?.cooldownUntil ?? 0, failures: prev?.failures ?? 0, lastError: prev?.lastError ?? null,
      calls: prev?.calls ?? 0, errors: prev?.errors ?? 0, successes: prev?.successes ?? 0, lastUsedAt: prev?.lastUsedAt ?? null,
    });
  });
  let cursor = 0;

  function acquire() {
    for (let i = 0; i < entries.length; i += 1) {
      const e = entries[(cursor + i) % entries.length];
      if (e.cooldownUntil <= now()) {
        cursor = (cursor + i + 1) % entries.length;
        return e;
      }
    }
    return null;
  }

  function reportFailure(entry, err) {
    const kind = classifyError(err);
    if (kind === 'BAD_REQUEST') return kind;
    const ms = kind === 'RATE_LIMIT' ? (retryDelayMs(err) ?? KEY_COOLDOWN_MS.RATE_LIMIT) : KEY_COOLDOWN_MS[kind];
    entry.cooldownUntil = now() + ms;
    entry.failures += 1;
    entry.lastError = kind;
    return kind;
  }

  /** Chạy fn(apiKey) với key khả dụng; lỗi tạm thời thì thử key khác (tối đa số key). */
  async function run(fn) {
    let lastErr = null;
    for (let attempt = 0; attempt < entries.length; attempt += 1) {
      const entry = acquire();
      if (!entry) break;
      entry.calls += 1;
      entry.lastUsedAt = now();
      try {
        const out = await fn(entry.key, entry);
        entry.successes += 1;
        return out;
      } catch (err) {
        entry.errors += 1;
        const kind = reportFailure(entry, err);
        logger.warn(`[keyPool] ${entry.label} lỗi ${kind}: ${String(err.message).slice(0, 160)}`);
        if (kind === 'BAD_REQUEST') throw err;
        lastErr = err;
      }
    }
    throw lastErr || new NoKeyAvailableError();
  }

  return {
    run,
    acquire,
    reportFailure,
    size: entries.length,
    available: () => entries.filter((e) => e.cooldownUntil <= now()).length,
    status: () => entries.map((e) => ({
      label: e.label, id: e.id, source: e.source, coolingDownMs: Math.max(0, e.cooldownUntil - now()), failures: e.failures, lastError: e.lastError,
      calls: e.calls, errors: e.errors, successes: e.successes, lastUsedAt: e.lastUsedAt ? new Date(e.lastUsedAt).toISOString() : null,
    })),
    exportState: () => new Map(entries.map((e) => [e.key, { cooldownUntil: e.cooldownUntil, failures: e.failures, lastError: e.lastError, calls: e.calls, errors: e.errors, successes: e.successes, lastUsedAt: e.lastUsedAt }])),
    entries: () => entries.map((e) => ({ key: e.key, label: e.label, id: e.id, source: e.source })),
  };
}

module.exports = { createGeminiKeyPool, classifyError, retryDelayMs, KEY_COOLDOWN_MS, NoKeyAvailableError };
