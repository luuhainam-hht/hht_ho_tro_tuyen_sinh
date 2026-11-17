'use strict';
/**
 * WebSocket hub dùng chung cổng HTTP.
 *   broadcast(type, payload) = gửi client nội bộ + pg_notify (pgBus) cho bản chạy khác.
 * Sự kiện chứa dữ liệu nội bộ (câu hỏi, liên hệ thí sinh) -> chỉ gửi socket ĐÃ XÁC THỰC.
 * Client xác thực bằng gói đầu tiên {type:'AUTH', token} (không đặt token trên URL vì URL bị ghi log).
 */
const { WebSocketServer } = require('ws');

const EVENTS = Object.freeze([
  'QUESTION_LOGGED',
  'HANDOFF_CREATED',
  'HANDOFF_UPDATED',
  'FAQ_UPDATED',
  'KB_DOCUMENT_UPDATED',
  'JOB_UPDATED',
  'APPOINTMENT_BOOKED',
  'APPOINTMENT_CANCELLED',
  'APPOINTMENT_RESCHEDULED',
  'APPOINTMENT_CHECKED_IN',
  'APPOINTMENT_COMPLETED',
  'APPOINTMENT_NO_SHOW',
  'CONFIG_UPDATED',
  'AI_KEYS_UPDATED',
  'CATALOG_UPDATED', // ngành, hồ sơ, đợt nhận hồ sơ, liên hệ do Phòng Tuyển sinh/Khoa sửa
]);
const EVENT_SET = new Set(EVENTS);
// Sự kiện an toàn cho mọi người (không có dữ liệu cá nhân): trang công khai dùng để tải lại cấu hình.
const PUBLIC_EVENTS = new Set(['CONFIG_UPDATED']);

const WS_PATH = '/ws';
const WS_HEARTBEAT_INTERVAL_MS = 30_000;
const WS_MAX_PAYLOAD_BYTES = 2 * 1024;

function createWsHub({ isOriginAllowed = () => true, resolveToken = async () => null, logger = console } = {}) {
  let wss = null;
  let heartbeat = null;
  let bus = null;

  function attach(httpServer) {
    wss = new WebSocketServer({
      server: httpServer,
      path: WS_PATH,
      maxPayload: WS_MAX_PAYLOAD_BYTES,
      verifyClient: ({ origin, req }) => isOriginAllowed(origin, req.headers.host),
    });
    wss.on('connection', (socket) => {
      socket.isAlive = true;
      socket.staff = null;
      socket.on('pong', () => { socket.isAlive = true; });
      socket.on('error', (err) => logger.warn('[ws] lỗi socket:', err.message));
      socket.on('message', async (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          if (msg.type === 'AUTH' && typeof msg.token === 'string') {
            socket.staff = await resolveToken(msg.token);
            socket.send(JSON.stringify({ type: 'AUTH_RESULT', payload: { ok: Boolean(socket.staff) } }));
          }
        } catch { /* bỏ qua gói hỏng */ }
      });
      // Chưa xác thực vẫn giữ kết nối (trang công khai) nhưng chỉ nhận PUBLIC_EVENTS.
      socket.send(JSON.stringify({ type: 'HELLO', payload: {} }));
    });
    heartbeat = setInterval(() => {
      for (const s of wss.clients) {
        if (!s.isAlive) { s.terminate(); continue; }
        s.isAlive = false;
        s.ping();
      }
    }, WS_HEARTBEAT_INTERVAL_MS);
    heartbeat.unref();
  }

  function localBroadcast(type, payload, { remote = false } = {}) {
    if (!wss || !EVENT_SET.has(type)) return;
    const data = JSON.stringify({ type, payload, ts: new Date().toISOString(), remote });
    const isPublic = PUBLIC_EVENTS.has(type);
    for (const s of wss.clients) {
      if (s.readyState === s.OPEN && (isPublic || s.staff)) s.send(data);
    }
  }

  /** Gọi SAU COMMIT; không bao giờ ném lỗi. */
  function broadcast(type, payload = {}) {
    if (!EVENT_SET.has(type)) {
      logger.warn(`[ws] bỏ qua sự kiện không khai báo: ${type}`);
      return;
    }
    try { localBroadcast(type, payload); } catch (err) { logger.warn('[ws] gửi nội bộ lỗi:', err.message); }
    if (bus) bus.publish(type, payload);
  }

  async function close() {
    clearInterval(heartbeat);
    if (!wss) return;
    for (const s of wss.clients) s.close(1001, 'server-restart');
    await new Promise((r) => wss.close(r));
    wss = null;
  }

  return { attach, broadcast, localBroadcast, useBus: (b) => { bus = b; }, close, clientCount: () => wss?.clients.size ?? 0 };
}

module.exports = { createWsHub, EVENTS, PUBLIC_EVENTS, WS_PATH };
