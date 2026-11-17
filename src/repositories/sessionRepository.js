'use strict';
async function insert(c, { tokenHash, staffId, role, ttlSeconds, ip, userAgent }) {
  const { rows } = await c.query(
    `INSERT INTO staff_sessions (token_hash, staff_id, role, expires_at, ip, user_agent)
     VALUES (?, ?, ?, now() + make_interval(secs => ?), ?, ?) RETURNING expires_at`,
    [tokenHash, staffId, role, ttlSeconds, ip, userAgent],
  );
  return rows[0];
}

/** Phiên còn hạn + tài khoản còn hoạt động. Vai trò lấy từ bảng staff (đổi vai trò có hiệu lực ngay). */
async function touchValid(c, tokenHash) {
  const { rows } = await c.query(
    `UPDATE staff_sessions s SET last_seen_at = now()
       FROM staff u
      WHERE s.token_hash = ? AND s.expires_at > now() AND u.id = s.staff_id AND u.is_active
      RETURNING u.id, u.username, u.full_name, u.role, u.faculty, u.must_change_password, s.expires_at`,
    [tokenHash],
  );
  return rows[0] || null;
}

const remove = (c, tokenHash) => c.query('DELETE FROM staff_sessions WHERE token_hash = ?', [tokenHash]);
const removeAllForStaff = (c, staffId, exceptHash = null) =>
  c.query('DELETE FROM staff_sessions WHERE staff_id = ? AND token_hash IS DISTINCT FROM ?', [staffId, exceptHash]);
const removeExpired = async (c) => (await c.query('DELETE FROM staff_sessions WHERE expires_at <= now()')).rowCount;

module.exports = { insert, touchValid, remove, removeAllForStaff, removeExpired };
