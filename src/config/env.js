'use strict';
/**
 * Cấu hình hạ tầng từ biến môi trường. Tham số NGHIỆP VỤ nằm ở system_configs (configService).
 * Vì sao tách: thứ cần có trước khi kết nối DB (URL, cổng, bí mật) không thể nằm trong DB.
 */
require('dotenv').config({ quiet: true });
const crypto = require('node:crypto');

const list = (name) => (process.env[name] || '').split(',').map((s) => s.trim()).filter(Boolean);
const int = (name, fallback) => {
  const n = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
};

// Gộp GEMINI_API_KEYS, GEMINI_API_KEY, GEMINI_API_KEY_1..n và loại trùng (học theo bản gốc).
function collectGeminiKeys() {
  const keys = [...list('GEMINI_API_KEYS'), ...list('GEMINI_API_KEY')];
  for (const [k, v] of Object.entries(process.env)) if (/^GEMINI_API_KEY_\d+$/.test(k) && v) keys.push(v.trim());
  return [...new Set(keys)];
}

// Khóa Groq: GROQ_API_KEYS (phẩy), GROQ_API_KEY, GROQ_API_KEY_1..n. Test bỏ qua để không gọi mạng thật.
function collectGroqKeys() {
  if (process.env.TEST_FAKE_LLM) return [];
  const keys = [...list('GROQ_API_KEYS'), ...list('GROQ_API_KEY')];
  for (const [k, v] of Object.entries(process.env)) if (/^GROQ_API_KEY_\d+$/.test(k) && v) keys.push(v.trim());
  return [...new Set(keys)];
}

const NODE_ENV = process.env.NODE_ENV || 'development';
let visitorSecret = process.env.VISITOR_HASH_SECRET || '';
const secretIsEphemeral = !visitorSecret && !process.env.SECRET_ENCRYPTION_KEY;
if (!visitorSecret) {
  // Dev/test: sinh ngẫu nhiên mỗi lần chạy (visitor_hash đổi sau restart – chấp nhận được).
  if (NODE_ENV === 'production') console.warn('[env] THIẾU VISITOR_HASH_SECRET – đặt trong .env cho môi trường thật');
  visitorSecret = crypto.randomBytes(32).toString('hex');
}

module.exports = Object.freeze({
  NODE_ENV,
  PORT: int('PORT', 3000),
  DATABASE_URL: process.env.DATABASE_URL || '',
  DATABASE_SSL: process.env.DATABASE_SSL === 'true' || /neon\.tech|sslmode=require/.test(process.env.DATABASE_URL || ''),
  DB_POOL_MAX: int('DB_POOL_MAX', 10),
  INSTANCE_ID: process.env.INSTANCE_ID || `${process.pid}-${crypto.randomBytes(4).toString('hex')}`,
  TRUST_PROXY: int('TRUST_PROXY', 1),
  RATE_LIMIT_ENABLED: process.env.RATE_LIMIT_ENABLED !== 'false',
  SCHEDULER_ENABLED: process.env.SCHEDULER_ENABLED !== 'false',
  JOB_RUNNER_ENABLED: process.env.JOB_RUNNER_ENABLED !== 'false',
  PUBLIC_BASE_URL: (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, ''),
  UPLOAD_DIR: process.env.UPLOAD_DIR || 'data/uploads',
  GEMINI_API_KEYS: collectGeminiKeys(),
  GROQ_API_KEYS: collectGroqKeys(),
  VISITOR_HASH_SECRET: visitorSecret,
  // Khóa mã hóa khóa API lưu trong CSDL. Mặc định suy ra từ VISITOR_HASH_SECRET -> ĐỔI bí mật này thì phải nhập lại khóa API.
  SECRET_ENCRYPTION_KEY: process.env.SECRET_ENCRYPTION_KEY || visitorSecret,
  SECRET_IS_EPHEMERAL: secretIsEphemeral,
  MESSENGER_VERIFY_TOKEN: process.env.MESSENGER_VERIFY_TOKEN || '',
  MESSENGER_APP_SECRET: process.env.MESSENGER_APP_SECRET || '',
  MESSENGER_PAGE_TOKEN: process.env.MESSENGER_PAGE_TOKEN || '',
  ADMIN_INITIAL_USERNAME: process.env.ADMIN_INITIAL_USERNAME || 'admin',
  ADMIN_INITIAL_PASSWORD: process.env.ADMIN_INITIAL_PASSWORD || '',
  SEED_SAMPLE_STAFF: process.env.SEED_SAMPLE_STAFF === 'true',
});
