'use strict';
/**
 * Kho nhiều API key xoay vòng, cooldown theo LOẠI lỗi (module thuần, dùng cho mọi LLM API).
 *   429/RESOURCE_EXHAUSTED -> nghỉ 60s (hoặc retryDelay Google trả về)
 *   401/403                -> nghỉ 1 giờ (key sai/bị thu hồi)
 *   5xx                    -> nghỉ 15s
 *   mạng/timeout           -> nghỉ 10s
 *   400 (lỗi yêu cầu)      -> ném ngay, KHÔNG đổi key (đổi key cũng sai y như vậy)
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
  if (status && status >= 500) return 'SERVER';
  return 'NETWORK';
}

/** "retryDelay":"37s" trong thông báo lỗi Gemini -> ms */
function retryDelayMs(err) {
  const m = /retryDelay"?\s*[:=]\s*"?(\d+(?:\.\d+)?)s/.exec(String(err?.message || ''));
  return m ? Math.ceil(Number(m[1]) * 1000) : null;
}

function createGeminiKeyPool(keys, { now = () => Date.now(), logger = console } = {}) {
  const entries = [...new Set(keys)].map((key, i) => ({ key, label: `key#${i + 1}`, cooldownUntil: 0, failures: 0 }));
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
    return kind;
  }

  /** Chạy fn(apiKey) với key khả dụng; lỗi tạm thời thì thử key khác (tối đa số key). */
  async function run(fn) {
    let lastErr = null;
    for (let attempt = 0; attempt < entries.length; attempt += 1) {
      const entry = acquire();
      if (!entry) break;
      try {
        return await fn(entry.key);
      } catch (err) {
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
    status: () => entries.map((e) => ({ label: e.label, coolingDownMs: Math.max(0, e.cooldownUntil - now()), failures: e.failures })),
  };
}

module.exports = { createGeminiKeyPool, classifyError, retryDelayMs, KEY_COOLDOWN_MS, NoKeyAvailableError };
