/**
 * wsClient: tự kết nối lại (backoff ×1,5, tối đa 15s, có jitter), đăng ký on(type, fn) hoặc on('*').
 * Có token cán bộ thì gửi {type:'AUTH'} ngay khi mở kết nối (không đặt token trên URL).
 */
(function () {
  'use strict';
  const WS_RECONNECT_BASE_MS = 1000;
  const WS_RECONNECT_FACTOR = 1.5;
  const WS_RECONNECT_MAX_MS = 15000;

  window.createWsClient = function createWsClient({ path = '/ws', getToken = () => null } = {}) {
    const handlers = new Map();
    let delay = WS_RECONNECT_BASE_MS;
    let everOpen = false;
    const emit = (type, payload) => {
      for (const key of [type, '*']) for (const fn of handlers.get(key) || []) { try { fn(payload, type); } catch (e) { console.error(e); } }
    };
    function connect() {
      const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${path}`);
      ws.addEventListener('open', () => {
        delay = WS_RECONNECT_BASE_MS;
        const token = getToken();
        if (token) ws.send(JSON.stringify({ type: 'AUTH', token }));
        emit('STATUS', { connected: true });
        if (everOpen) emit('RECONNECTED', {});
        everOpen = true;
      });
      ws.addEventListener('message', (e) => { try { const m = JSON.parse(e.data); emit(m.type, m.payload); } catch { /* bỏ qua */ } });
      ws.addEventListener('close', () => {
        emit('STATUS', { connected: false });
        setTimeout(connect, delay * (0.8 + Math.random() * 0.4));
        delay = Math.min(delay * WS_RECONNECT_FACTOR, WS_RECONNECT_MAX_MS);
      });
    }
    connect();
    return {
      on(type, fn) {
        if (!handlers.has(type)) handlers.set(type, new Set());
        handlers.get(type).add(fn);
        return () => handlers.get(type).delete(fn);
      },
    };
  };
})();
