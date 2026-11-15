'use strict';
/**
 * Wrapper PostgreSQL (pg 8, tương thích Neon serverless).
 *
 *   db.query(sql, params)      -> { rows, rowCount }   placeholder '?'
 *   db.withTransaction(fn)     -> kết quả của fn(client)
 *
 * Nguyên tắc retry:
 *   - CHỈ retry lỗi kết nối (Neon hay cắt kết nối idle / cold start), KHÔNG retry lỗi SQL.
 *   - Trong transaction: không retry từng câu lẻ (sẽ chạy nửa vời trên kết nối mới),
 *     mà ROLLBACK rồi chạy lại CẢ khối fn từ đầu.
 *   - Lỗi xảy ra đúng lúc COMMIT: không biết server đã commit hay chưa -> KHÔNG chạy lại
 *     (tránh ghi đôi), ném lỗi để phía gọi xử lý.
 */
const { Pool, types } = require('pg');

// BIGINT/BIGSERIAL (OID 20) mặc định trả về chuỗi; id của hệ thống không vượt 2^53 nên đổi sang
// Number để JSON/so sánh nhất quán (tránh lỗi '1' !== 1 ở frontend).
types.setTypeParser(20, (v) => Number(v));
// DATE (OID 1082) giữ nguyên chuỗi 'YYYY-MM-DD': mặc định pg tạo Date theo múi giờ MÁY -> lệch ngày trên server UTC.
types.setTypeParser(1082, (v) => v);
const env = require('./env');

const DB_MAX_ATTEMPTS = 3;
const DB_RETRY_BASE_DELAY_MS = 400; // 400ms, 800ms (×2 mỗi lần)
const DB_CONNECTION_TIMEOUT_MS = 20_000;
const DB_IDLE_TIMEOUT_MS = 30_000;

const CONNECTION_ERROR_CODES = new Set([
  'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH',
  '57P01', // admin_shutdown
  '57P02', // crash_shutdown
  '57P03', // cannot_connect_now (Neon đang đánh thức compute)
  '08000', '08001', '08003', '08004', '08006', // connection_exception
]);
const CONNECTION_ERROR_PATTERN = /connection terminated|timeout exceeded when trying to connect|Connection terminated unexpectedly|server closed the connection/i;

function isConnectionError(err) {
  if (!err) return false;
  if (CONNECTION_ERROR_CODES.has(err.code)) return true;
  return CONNECTION_ERROR_PATTERN.test(err.message || '');
}

/**
 * Đổi '?' -> $1, $2… Bỏ qua '?' nằm trong chuỗi '…', định danh "…", và comment '--'.
 * Vì sao tự viết: giữ cú pháp '?' quen thuộc mà không đụng toán tử JSONB trong literal.
 */
function toPgPlaceholders(sql) {
  let out = '';
  let index = 0;
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === "'" || ch === '"') {
      const end = sql.indexOf(ch, i + 1);
      const stop = end === -1 ? sql.length : end + 1;
      out += sql.slice(i, stop);
      i = stop;
      continue;
    }
    if (ch === '-' && sql[i + 1] === '-') {
      const end = sql.indexOf('\n', i);
      const stop = end === -1 ? sql.length : end;
      out += sql.slice(i, stop);
      i = stop;
      continue;
    }
    if (ch === '?') {
      index += 1;
      out += `$${index}`;
    } else {
      out += ch;
    }
    i += 1;
  }
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const backoffMs = (attempt) => DB_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);

function wrapClient(client) {
  return {
    async query(sql, params = []) {
      const res = await client.query(toPgPlaceholders(sql), params);
      return { rows: res.rows, rowCount: res.rowCount };
    },
    /** SQL nhiều câu, không tham số (schema.sql, khối DO $$…$$): KHÔNG đổi placeholder. */
    async raw(sql) {
      await client.query(sql);
    },
  };
}

function createDb(pool, { logger = console } = {}) {
  // Kết nối idle bị Neon cắt sẽ phát 'error' trên pool; không bắt sẽ làm sập process.
  pool.on('error', (err) => logger.warn('[db] lỗi kết nối nhàn rỗi:', err.message));
  pool.on('connect', (client) => {
    client.on('error', (err) => logger.warn('[db] lỗi trên client:', err.message));
  });

  async function query(sql, params = []) {
    const text = toPgPlaceholders(sql);
    for (let attempt = 1; ; attempt += 1) {
      try {
        const res = await pool.query(text, params);
        return { rows: res.rows, rowCount: res.rowCount };
      } catch (err) {
        if (!isConnectionError(err) || attempt >= DB_MAX_ATTEMPTS) throw err;
        logger.warn(`[db] lỗi kết nối, thử lại lần ${attempt}:`, err.message);
        await sleep(backoffMs(attempt));
      }
    }
  }

  async function withTransaction(fn) {
    for (let attempt = 1; ; attempt += 1) {
      let client;
      let committing = false;
      try {
        client = await pool.connect();
        await client.query('BEGIN');
        const result = await fn(wrapClient(client));
        committing = true;
        await client.query('COMMIT');
        client.release();
        return result;
      } catch (err) {
        if (client) {
          await client.query('ROLLBACK').catch(() => {});
          // release(err) hủy hẳn kết nối hỏng thay vì trả về pool.
          client.release(isConnectionError(err) ? err : undefined);
        }
        const retriable = isConnectionError(err) && !committing && attempt < DB_MAX_ATTEMPTS;
        if (!retriable) throw err;
        logger.warn(`[db] transaction mất kết nối, chạy lại cả khối (lần ${attempt}):`, err.message);
        await sleep(backoffMs(attempt));
      }
    }
  }

  /** Lấy client riêng (cho advisory lock cấp session). Phía gọi phải release(). */
  async function acquire() {
    const client = await pool.connect();
    return { ...wrapClient(client), release: (err) => client.release(err) };
  }

  return { query, withTransaction, acquire, end: () => pool.end(), pool };
}

function createPool(connectionString = env.DATABASE_URL) {
  return new Pool({
    connectionString,
    max: env.DB_POOL_MAX,
    keepAlive: true,
    connectionTimeoutMillis: DB_CONNECTION_TIMEOUT_MS,
    idleTimeoutMillis: DB_IDLE_TIMEOUT_MS,
    ssl: env.DATABASE_SSL ? { rejectUnauthorized: true } : undefined,
  });
}

// Instance mặc định dùng chung toàn ứng dụng (lazy để test có thể đặt DATABASE_URL trước).
let defaultDb;
function getDb() {
  if (!defaultDb) defaultDb = createDb(createPool());
  return defaultDb;
}

module.exports = {
  getDb,
  createDb,
  createPool,
  toPgPlaceholders,
  isConnectionError,
  DB_MAX_ATTEMPTS,
};
