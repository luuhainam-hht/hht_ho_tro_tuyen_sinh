#!/usr/bin/env node
'use strict';
/** Đặt lại mật khẩu (hoặc tạo) tài khoản quản trị khi quên: node scripts/reset-admin-password.js <username> */
const bcrypt = require('bcryptjs');
const { getDb } = require('../src/config/db');
const { temporaryPassword } = require('../src/services/staffService');

(async () => {
  const username = (process.argv[2] || 'admin').toLowerCase();
  const db = getDb();
  const password = temporaryPassword();
  const hash = await bcrypt.hash(password, 12);
  const { rows } = await db.query(
    `INSERT INTO staff (username, password_hash, full_name, role, must_change_password)
     VALUES (?, ?, 'Quản trị hệ thống', 'SUPER_ADMIN', TRUE)
     ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash, must_change_password = TRUE,
       failed_login_attempts = 0, locked_until = NULL, is_active = TRUE
     RETURNING id`, [username, hash],
  );
  await db.query('DELETE FROM staff_sessions WHERE staff_id = ?', [rows[0].id]);
  console.log(`Tài khoản: ${username}\nMật khẩu tạm: ${password}\n(Bắt buộc đổi khi đăng nhập)`);
  await db.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
