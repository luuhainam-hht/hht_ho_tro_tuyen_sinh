'use strict';
/**
 * Đăng nhập cán bộ: token ngẫu nhiên phía server (bảng staff_sessions), thu hồi được ngay.
 * Khóa 5 lần sai / 15 phút; phiên 8 giờ (một ca làm việc).
 */
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { HttpError } = require('../utils/httpError');
const { sha256 } = require('../utils/crypto');
const { assertStrongPassword } = require('../utils/passwordPolicy');
const staffRepository = require('../repositories/staffRepository');
const sessionRepository = require('../repositories/sessionRepository');
const auditRepository = require('../repositories/auditRepository');

const SESSION_TTL_SECONDS = 8 * 60 * 60;
const LOGIN_MAX_FAILED_ATTEMPTS = 5;
const LOGIN_LOCK_SECONDS = 15 * 60;
const BCRYPT_ROUNDS = 12;
const DUMMY_HASH = bcrypt.hashSync('khong-ton-tai-tai-khoan', 4); // cân thời gian khi sai username
const LOCKED_MESSAGE = 'Tài khoản tạm khóa do đăng nhập sai nhiều lần. Vui lòng thử lại sau 15 phút.';

function createAuthService({ db }) {
  async function login({ username, password, ip, userAgent }) {
    const user = await staffRepository.findByUsername(db, username);
    if (!user) {
      await bcrypt.compare(password, DUMMY_HASH);
      throw new HttpError(401, 'Sai tên đăng nhập hoặc mật khẩu');
    }
    if (!user.is_active) throw new HttpError(403, 'Tài khoản đã bị vô hiệu hóa');
    if (user.locked_until && new Date(user.locked_until) > new Date()) throw new HttpError(423, LOCKED_MESSAGE);
    if (!(await bcrypt.compare(password, user.password_hash))) {
      const st = await staffRepository.registerFailedLogin(db, user.id, LOGIN_MAX_FAILED_ATTEMPTS, LOGIN_LOCK_SECONDS);
      if (st.locked_until && new Date(st.locked_until) > new Date()) throw new HttpError(423, LOCKED_MESSAGE);
      throw new HttpError(401, 'Sai tên đăng nhập hoặc mật khẩu');
    }
    await staffRepository.update(db, user.id, { failed_login_attempts: 0, locked_until: null });
    const token = crypto.randomBytes(32).toString('hex'); // 64 hex như bản gốc
    const s = await sessionRepository.insert(db, { tokenHash: sha256(token), staffId: user.id, role: user.role, ttlSeconds: SESSION_TTL_SECONDS, ip, userAgent });
    return {
      token,
      expiresAt: s.expires_at,
      user: { id: Number(user.id), username: user.username, fullName: user.full_name, role: user.role, mustChangePassword: user.must_change_password },
    };
  }

  async function resolveToken(token) {
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
    const r = await sessionRepository.touchValid(db, sha256(token));
    return r && { id: Number(r.id), username: r.username, fullName: r.full_name, role: r.role, mustChangePassword: r.must_change_password };
  }

  const logout = (token) => (token ? sessionRepository.remove(db, sha256(token)) : null);

  async function changePassword({ actor, token, currentPassword, newPassword, ip }) {
    assertStrongPassword(newPassword, actor.username);
    return db.withTransaction(async (c) => {
      const u = await staffRepository.findByIdForUpdate(c, actor.id);
      if (!(await bcrypt.compare(currentPassword, u.password_hash))) throw new HttpError(400, 'Mật khẩu hiện tại không đúng');
      if (await bcrypt.compare(newPassword, u.password_hash)) throw new HttpError(400, 'Mật khẩu mới phải khác mật khẩu cũ');
      await staffRepository.update(c, actor.id, { password_hash: await bcrypt.hash(newPassword, BCRYPT_ROUNDS), must_change_password: false });
      // Đăng xuất mọi phiên khác (đề phòng mật khẩu cũ đã lộ)
      await sessionRepository.removeAllForStaff(c, actor.id, sha256(token));
      await auditRepository.insert(c, { actorId: actor.id, action: 'PASSWORD_CHANGE', targetType: 'STAFF', targetId: actor.id, ip });
      return { ok: true };
    });
  }

  return { login, resolveToken, logout, changePassword, purgeExpiredSessions: () => sessionRepository.removeExpired(db) };
}

module.exports = { createAuthService, SESSION_TTL_SECONDS, LOGIN_MAX_FAILED_ATTEMPTS, LOGIN_LOCK_SECONDS, BCRYPT_ROUNDS };
