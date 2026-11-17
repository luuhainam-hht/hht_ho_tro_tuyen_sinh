'use strict';
/**
 * Đăng nhập cán bộ: token ngẫu nhiên phía server (bảng staff_sessions), thu hồi được ngay.
 * Mặc định khóa 5 lần sai / 15 phút, phiên 8 giờ (một ca làm việc); Admin chỉnh được trong nhóm
 * tham số SECURITY (PASSWORD_MIN_LENGTH, SESSION_TTL_HOURS, LOGIN_MAX_FAILED_ATTEMPTS, LOGIN_LOCK_MINUTES).
 */
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { HttpError } = require('../utils/httpError');
const { sha256 } = require('../utils/crypto');
const { NOW } = require('../utils/sqlUpdate');
const { assertStrongPassword } = require('../utils/passwordPolicy');
const staffRepository = require('../repositories/staffRepository');
const sessionRepository = require('../repositories/sessionRepository');
const auditRepository = require('../repositories/auditRepository');
const { permissionsOf } = require('../constants/roles');

/** Thông tin cán bộ trả cho giao diện: kèm khoa (vai trò Cán bộ Khoa) và danh sách nhóm quyền. */
const toUser = (r) => ({
  id: Number(r.id), username: r.username, fullName: r.full_name, role: r.role, faculty: r.faculty || null,
  permissions: permissionsOf(r.role), mustChangePassword: r.must_change_password,
});

const SESSION_TTL_SECONDS = 8 * 60 * 60;
const LOGIN_MAX_FAILED_ATTEMPTS = 5;
const LOGIN_LOCK_SECONDS = 15 * 60;
const BCRYPT_ROUNDS = 12;
const DUMMY_HASH = bcrypt.hashSync('khong-ton-tai-tai-khoan', 4); // cân thời gian khi sai username
const lockedMessage = (minutes) => `Tài khoản tạm khóa do đăng nhập sai nhiều lần. Vui lòng thử lại sau ${minutes} phút.`;

/** Đọc chính sách đăng nhập từ cấu hình; không có configService (script CLI) thì dùng mặc định. */
function securityPolicy(configService) {
  const get = (k, d) => (configService?.getOr ? configService.getOr(k, d) : d);
  return {
    passwordMinLength: get('PASSWORD_MIN_LENGTH', 10),
    sessionTtlSeconds: get('SESSION_TTL_HOURS', SESSION_TTL_SECONDS / 3600) * 3600,
    maxFailedAttempts: get('LOGIN_MAX_FAILED_ATTEMPTS', LOGIN_MAX_FAILED_ATTEMPTS),
    lockSeconds: get('LOGIN_LOCK_MINUTES', LOGIN_LOCK_SECONDS / 60) * 60,
  };
}

function createAuthService({ db, configService = null }) {
  const policy = () => securityPolicy(configService);

  async function login({ username, password, ip, userAgent }) {
    const p = policy();
    const LOCKED_MESSAGE = lockedMessage(Math.round(p.lockSeconds / 60));
    const user = await staffRepository.findByUsername(db, username);
    if (!user) {
      await bcrypt.compare(password, DUMMY_HASH);
      throw new HttpError(401, 'Sai tên đăng nhập hoặc mật khẩu');
    }
    if (!user.is_active) throw new HttpError(403, 'Tài khoản đã bị vô hiệu hóa');
    if (user.locked_until && new Date(user.locked_until) > new Date()) throw new HttpError(423, LOCKED_MESSAGE);
    if (!(await bcrypt.compare(password, user.password_hash))) {
      const st = await staffRepository.registerFailedLogin(db, user.id, p.maxFailedAttempts, p.lockSeconds);
      if (st.locked_until && new Date(st.locked_until) > new Date()) throw new HttpError(423, LOCKED_MESSAGE);
      throw new HttpError(401, 'Sai tên đăng nhập hoặc mật khẩu');
    }
    await staffRepository.update(db, user.id, { failed_login_attempts: 0, locked_until: null, last_login_at: NOW });
    const token = crypto.randomBytes(32).toString('hex'); // 64 hex như bản gốc
    const s = await sessionRepository.insert(db, { tokenHash: sha256(token), staffId: user.id, role: user.role, ttlSeconds: p.sessionTtlSeconds, ip, userAgent });
    return {
      token,
      expiresAt: s.expires_at,
      user: toUser(user),
    };
  }

  async function resolveToken(token) {
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
    const r = await sessionRepository.touchValid(db, sha256(token));
    return r && toUser(r);
  }

  const logout = (token) => (token ? sessionRepository.remove(db, sha256(token)) : null);

  async function changePassword({ actor, token, currentPassword, newPassword, ip }) {
    assertStrongPassword(newPassword, actor.username, policy().passwordMinLength);
    return db.withTransaction(async (c) => {
      const u = await staffRepository.findByIdForUpdate(c, actor.id);
      if (!(await bcrypt.compare(currentPassword, u.password_hash))) throw new HttpError(400, 'Mật khẩu hiện tại không đúng');
      if (await bcrypt.compare(newPassword, u.password_hash)) throw new HttpError(400, 'Mật khẩu mới phải khác mật khẩu cũ');
      await staffRepository.update(c, actor.id, { password_hash: await bcrypt.hash(newPassword, BCRYPT_ROUNDS), must_change_password: false, password_changed_at: NOW });
      // Đăng xuất mọi phiên khác (đề phòng mật khẩu cũ đã lộ)
      await sessionRepository.removeAllForStaff(c, actor.id, sha256(token));
      await auditRepository.insert(c, { actorId: actor.id, action: 'PASSWORD_CHANGE', targetType: 'STAFF', targetId: actor.id, ip });
      return { ok: true };
    });
  }

  return { login, resolveToken, logout, changePassword, policy, purgeExpiredSessions: () => sessionRepository.removeExpired(db) };
}

module.exports = { createAuthService, securityPolicy, SESSION_TTL_SECONDS, LOGIN_MAX_FAILED_ATTEMPTS, LOGIN_LOCK_SECONDS, BCRYPT_ROUNDS };
