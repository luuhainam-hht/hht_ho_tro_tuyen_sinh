'use strict';
/**
 * Migration idempotent chạy MỖI lần khởi động, dưới advisory lock (nhiều bản chạy khởi động cùng lúc
 * không chạy chồng DDL):
 *   1. db/schema.sql (IF NOT EXISTS / CREATE OR REPLACE)
 *   2. tham số mặc định (configDefaults.js) – chỉ thêm khóa mới & cập nhật metadata, KHÔNG ghi đè giá trị
 *   3. MIGRATIONS bổ sung theo id (schema_migrations)
 *   4. dữ liệu tuyển sinh từ db/seed (ON CONFLICT DO NOTHING)
 *   5. Admin đầu tiên từ ADMIN_INITIAL_PASSWORD (bắt buộc đổi mật khẩu khi đăng nhập)
 */
const fs = require('node:fs');
const path = require('node:path');
const bcrypt = require('bcryptjs');
const env = require('../config/env');
const { CONFIG_DEFAULTS } = require('../config/configDefaults');
const { seedAll } = require('./seedData');
const { assertStrongPassword } = require('../utils/passwordPolicy');

const SCHEMA_FILE = path.join(__dirname, '..', '..', 'db', 'schema.sql');
const MIGRATION_LOCK_KEY = 'hht_ts:migrations';

// Thêm thay đổi schema mới vào CUỐI; không sửa migration đã phát hành.
const MIGRATIONS = [
  // { id: '2027-01-10-add-xyz', sql: 'ALTER TABLE … ADD COLUMN IF NOT EXISTS …' },
  {
    id: '2026-11-16-staff-login-tracking',
    sql: `ALTER TABLE staff ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
          ALTER TABLE staff ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;`,
  },
  {
    // CSDL tạo trước bản này có CHECK cũ (thiếu AI, AI_KEY) -> nhật ký cài đặt AI bị từ chối.
    id: '2026-11-16-audit-ai-targets',
    sql: `ALTER TABLE audit_logs DROP CONSTRAINT IF EXISTS audit_logs_target_type_check;
          ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_target_type_check CHECK (target_type IN ('KB_DOCUMENT', 'FAQ', 'MAJOR',
            'HANDOFF', 'CONFIG', 'STAFF', 'SYSTEM', 'APPOINTMENT', 'ADMISSION_ITEM', 'AI', 'AI_KEY'));`,
  },
];

async function upsertConfigDefaults(c) {
  for (const d of CONFIG_DEFAULTS) {
    await c.query(
      `INSERT INTO system_configs (key, value, value_type, min_bound, max_bound, description, is_public)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET value_type = EXCLUDED.value_type, min_bound = EXCLUDED.min_bound,
         max_bound = EXCLUDED.max_bound, description = EXCLUDED.description, is_public = EXCLUDED.is_public
       WHERE (system_configs.value_type, system_configs.min_bound, system_configs.max_bound, system_configs.description, system_configs.is_public)
             IS DISTINCT FROM (EXCLUDED.value_type, EXCLUDED.min_bound, EXCLUDED.max_bound, EXCLUDED.description, EXCLUDED.is_public)`,
      [d.key, d.value, d.type, d.min, d.max, d.description, d.isPublic],
    );
  }
}

async function ensureInitialAdmin(c, logger) {
  const { rows } = await c.query("SELECT COUNT(*)::int AS n FROM staff WHERE role = 'SUPER_ADMIN'");
  if (rows[0].n > 0) return;
  if (!env.ADMIN_INITIAL_PASSWORD) {
    logger.warn('[migrate] Chưa có quản trị viên. Đặt ADMIN_INITIAL_PASSWORD trong .env rồi khởi động lại (hoặc chạy scripts/reset-admin-password.js).');
    return;
  }
  // Mật khẩu yếu: KHÔNG làm sập khởi động (máy chủ vẫn phục vụ thí sinh), chỉ bỏ qua việc tạo admin.
  try {
    assertStrongPassword(env.ADMIN_INITIAL_PASSWORD, env.ADMIN_INITIAL_USERNAME);
  } catch (err) {
    logger.warn(`[migrate] Chưa tạo quản trị viên: ADMIN_INITIAL_PASSWORD không hợp lệ (${err.message}). `
      + 'Đặt mật khẩu ≥10 ký tự, có cả chữ và số, không chứa tên đăng nhập, rồi khởi động lại.');
    return;
  }
  await c.query(
    `INSERT INTO staff (username, password_hash, full_name, role, must_change_password)
     VALUES (?, ?, 'Quản trị hệ thống', 'SUPER_ADMIN', TRUE) ON CONFLICT (username) DO NOTHING`,
    [env.ADMIN_INITIAL_USERNAME, await bcrypt.hash(env.ADMIN_INITIAL_PASSWORD, 12)],
  );
  logger.info(`[migrate] Đã tạo quản trị viên "${env.ADMIN_INITIAL_USERNAME}" (phải đổi mật khẩu lần đầu).`);
}

async function runMigrations(db, { logger = console, seed = true, refreshSeed = false } = {}) {
  await db.withTransaction(async (c) => {
    await c.query('SELECT pg_advisory_xact_lock(hashtext(?))', [MIGRATION_LOCK_KEY]);
    await c.raw(fs.readFileSync(SCHEMA_FILE, 'utf8'));
    await upsertConfigDefaults(c);
    for (const m of MIGRATIONS) {
      const { rows } = await c.query('SELECT 1 FROM schema_migrations WHERE id = ?', [m.id]);
      if (rows.length) continue;
      await c.raw(m.sql);
      await c.query('INSERT INTO schema_migrations (id) VALUES (?) ON CONFLICT DO NOTHING', [m.id]);
      logger.info(`[migrate] áp dụng ${m.id}`);
    }
    if (seed) await seedAll(c, { refresh: refreshSeed });
    await ensureInitialAdmin(c, logger);
  });
}

if (require.main === module) {
  const { getDb } = require('../config/db');
  const db = getDb();
  // --refresh-seed: ghi đè FAQ/ngành/mục cẩm nang bằng dữ liệu db/seed mới nhất (dùng sau khi nhập lại Excel)
  const refreshSeed = process.argv.includes('--refresh-seed');
  runMigrations(db, { refreshSeed }).then(() => { console.log(refreshSeed ? '[migrate] xong (đã cập nhật dữ liệu tuyển sinh từ db/seed)' : '[migrate] xong'); return db.end(); })
    .catch((err) => { console.error('[migrate] lỗi:', err); process.exit(1); });
}

module.exports = { runMigrations, MIGRATIONS };
