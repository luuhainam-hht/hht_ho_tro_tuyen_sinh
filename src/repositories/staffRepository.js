'use strict';
const { updateWhitelisted } = require('../utils/sqlUpdate');

const PUBLIC_COLUMNS = 'id, username, full_name, email, role, faculty, is_active, must_change_password, locked_until, failed_login_attempts, last_login_at, password_changed_at, created_at, updated_at';
const UPDATABLE = new Set(['full_name', 'email', 'role', 'faculty', 'is_active', 'password_hash', 'must_change_password', 'failed_login_attempts', 'locked_until', 'last_login_at', 'password_changed_at']);

const findByUsername = async (c, username) => (await c.query('SELECT * FROM staff WHERE username = ?', [username])).rows[0] || null;
const findById = async (c, id) => (await c.query(`SELECT ${PUBLIC_COLUMNS} FROM staff WHERE id = ?`, [id])).rows[0] || null;
const findByIdForUpdate = async (c, id) => (await c.query('SELECT * FROM staff WHERE id = ? FOR UPDATE', [id])).rows[0] || null;
const list = async (c) => (await c.query(`SELECT ${PUBLIC_COLUMNS} FROM staff ORDER BY role, username`)).rows;
const countActiveByRole = async (c, role) => (await c.query('SELECT COUNT(*)::int AS n FROM staff WHERE role = ? AND is_active', [role])).rows[0].n;

async function insert(c, { username, passwordHash, fullName, email = null, role, faculty = null, mustChangePassword = true }) {
  const { rows } = await c.query(
    `INSERT INTO staff (username, password_hash, full_name, email, role, faculty, must_change_password)
     VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (username) DO NOTHING RETURNING ${PUBLIC_COLUMNS}`,
    [username, passwordHash, fullName, email, role, faculty, mustChangePassword],
  );
  return rows[0] || null;
}

const update = (c, id, fields) => updateWhitelisted(c, { table: 'staff', id, fields, allowed: UPDATABLE });

/** Một câu lệnh nguyên tử: hai request sai song song không thể cùng "lọt" qua ngưỡng khóa. */
async function registerFailedLogin(c, id, maxAttempts, lockSeconds) {
  const { rows } = await c.query(
    `UPDATE staff SET
       failed_login_attempts = CASE WHEN failed_login_attempts + 1 >= ? THEN 0 ELSE failed_login_attempts + 1 END,
       locked_until = CASE WHEN failed_login_attempts + 1 >= ? THEN now() + make_interval(secs => ?) ELSE locked_until END
     WHERE id = ? RETURNING failed_login_attempts, locked_until`,
    [maxAttempts, maxAttempts, lockSeconds, id],
  );
  return rows[0];
}

module.exports = { PUBLIC_COLUMNS, findByUsername, findById, findByIdForUpdate, list, countActiveByRole, insert, update, registerFailedLogin };
