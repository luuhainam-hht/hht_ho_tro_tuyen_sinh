'use strict';
/**
 * Bus realtime giữa nhiều bản chạy (Render scale >1, hoặc app + sync worker) qua LISTEN/NOTIFY.
 * Vì sao không dùng Redis: Postgres (Neon) đã có sẵn, lưu lượng sự kiện nhỏ.
 *
 * Bảo đảm: KHÔNG BAO GIỜ ném lỗi ra ngoài. Realtime chéo là tác vụ phụ; mất một sự kiện
 * chỉ khiến màn hình bản chạy khác chậm cập nhật, client sẽ tự đồng bộ khi kết nối lại.
 */
const { Client } = require('pg');
const env = require('../config/env');
const { cleanConnectionString } = require('../config/db');

const PG_BUS_CHANNEL = 'hht_ts_realtime';
// Giới hạn payload NOTIFY của Postgres là 8000 byte; chừa lề cho phong bì JSON.
const PG_NOTIFY_MAX_BYTES = 7500;
const PG_BUS_RECONNECT_BASE_MS = 1_000;
const PG_BUS_RECONNECT_MAX_MS = 30_000;

function createPgBus({ db, connectionString = env.DATABASE_URL, instanceId = env.INSTANCE_ID, logger = console } = {}) {
  let listener = null;
  let handler = () => {};
  let stopped = false;
  let reconnectAttempt = 0;
  let reconnectTimer = null;

  async function publish(type, payload) {
    try {
      let message = JSON.stringify({ instanceId, type, payload });
      if (Buffer.byteLength(message) > PG_NOTIFY_MAX_BYTES) {
        // Quá lớn: chỉ báo "có thay đổi", client tự gọi API lấy dữ liệu mới.
        message = JSON.stringify({ instanceId, type, payload: { truncated: true, id: payload?.id ?? null } });
      }
      await db.query('SELECT pg_notify(?, ?)', [PG_BUS_CHANNEL, message]);
    } catch (err) {
      logger.warn('[pgBus] không phát được sự kiện:', err.message);
    }
  }

  function scheduleReconnect() {
    if (stopped || reconnectTimer) return;
    const delay = Math.min(PG_BUS_RECONNECT_BASE_MS * 2 ** reconnectAttempt, PG_BUS_RECONNECT_MAX_MS);
    reconnectAttempt += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
    reconnectTimer.unref();
  }

  async function connect() {
    if (stopped) return;
    const client = new Client({
      // Neon: LISTEN không hoạt động qua PgBouncer (host "-pooler") -> nối thẳng compute.
      connectionString: cleanConnectionString(connectionString).replace('-pooler.', '.'),
      keepAlive: true,
      ssl: env.DATABASE_SSL ? { rejectUnauthorized: true } : undefined,
    });
    client.on('error', (err) => {
      logger.warn('[pgBus] mất kết nối LISTEN:', err.message);
      client.end().catch(() => {});
    });
    client.on('end', () => {
      if (listener === client) listener = null;
      scheduleReconnect();
    });
    client.on('notification', (msg) => {
      try {
        const data = JSON.parse(msg.payload);
        if (data.instanceId === instanceId) return; // sự kiện của chính mình đã gửi WS nội bộ rồi
        handler(data.type, data.payload);
      } catch (err) {
        logger.warn('[pgBus] sự kiện không đọc được:', err.message);
      }
    });
    try {
      await client.connect();
      await client.query(`LISTEN ${PG_BUS_CHANNEL}`);
      listener = client;
      reconnectAttempt = 0;
    } catch (err) {
      logger.warn('[pgBus] không kết nối được, sẽ thử lại:', err.message);
      client.end().catch(() => {});
      scheduleReconnect(); // idempotent nếu 'end' cũng đã kích hoạt
    }
  }

  return {
    publish,
    isConnected: () => Boolean(listener),
    async start(onEvent) {
      handler = onEvent;
      stopped = false;
      await connect();
    },
    async stop() {
      stopped = true;
      clearTimeout(reconnectTimer);
      if (listener) await listener.end().catch(() => {});
      listener = null;
    },
  };
}

module.exports = { createPgBus, PG_BUS_CHANNEL };
