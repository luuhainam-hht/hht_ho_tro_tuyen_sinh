/**
 * apiClient: fetch JSON + retry cho 429/502/503 (Neon cold start, Render đánh thức, rate-limit).
 * Không retry lỗi 4xx khác: lặp lại một yêu cầu sai chỉ làm chậm người dùng.
 */
(function () {
  'use strict';
  const RETRY_STATUSES = new Set([429, 502, 503]);
  const API_MAX_ATTEMPTS = 3;
  const API_RETRY_BASE_MS = 1000; // 1s, 2s, 3s – đủ cho Render free đánh thức
  const TOKEN_KEY = 'hht.token';

  function getToken() {
    try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; }
  }
  function setToken(token) {
    try { token ? sessionStorage.setItem(TOKEN_KEY, token) : sessionStorage.removeItem(TOKEN_KEY); } catch { /* chế độ riêng tư */ }
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function request(method, path, body) {
    for (let attempt = 1; ; attempt += 1) {
      let res;
      try {
        const headers = { Accept: 'application/json' };
        if (body !== undefined) headers['Content-Type'] = 'application/json';
        const token = getToken();
        if (token) headers.Authorization = `Bearer ${token}`;
        res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      } catch (networkErr) {
        if (attempt >= API_MAX_ATTEMPTS) throw new Error('Mất kết nối mạng, vui lòng thử lại.');
        await sleep(API_RETRY_BASE_MS * attempt);
        continue;
      }
      if (RETRY_STATUSES.has(res.status) && attempt < API_MAX_ATTEMPTS) {
        const retryAfter = Number(res.headers.get('Retry-After'));
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : API_RETRY_BASE_MS * attempt);
        continue;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 401) setToken(null);
        const err = new Error(data.error || `Lỗi ${res.status}`);
        err.status = res.status;
        err.code = data.code;
        err.details = data.details;
        throw err;
      }
      return data;
    }
  }

  /** Tải tệp (upload FormData hoặc tải về blob) – không retry để tránh gửi tệp hai lần. */
  async function raw(method, path, body) {
    const headers = {};
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(path, { method, headers, body });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      const err = new Error(data.error || `Lỗi ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return res;
  }

  window.apiClient = {
    raw,
    get: (p) => request('GET', p),
    post: (p, b = {}) => request('POST', p, b),
    put: (p, b = {}) => request('PUT', p, b),
    del: (p) => request('DELETE', p),
    getToken,
    setToken,
  };
})();
