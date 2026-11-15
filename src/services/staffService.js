'use strict';
const bcrypt = require('bcryptjs');
const crypto = require('node:crypto');
const { HttpError } = require('../utils/httpError');
const { assertStrongPassword } = require('../utils/passwordPolicy');
const staffRepository = require('../repositories/staffRepository');
const sessionRepository = require('../repositories/sessionRepository');
const auditRepository = require('../repositories/auditRepository');
const { NOW } = require('../utils/sqlUpdate');
const { BCRYPT_ROUNDS, securityPolicy } = require('./authService');

/** Mật khẩu tạm dễ đọc qua điện thoại, bỏ ký tự dễ nhầm (l/1, o/0); luôn có số ở cuối. */
function temporaryPassword(minLength = 12) {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < Math.max(10, minLength - 2); i += 1) s += alphabet[crypto.randomInt(alphabet.length)];
  return `${s}${crypto.randomInt(10, 99)}`;
}

function createStaffService({ db, configService = null }) {
  const minLength = () => securityPolicy(configService).passwordMinLength;

  async function create({ username, fullName, email, role, password: chosen = null, mustChangePassword = true, actor, ip }) {
    if (chosen) assertStrongPassword(chosen, username, minLength());
    const password = chosen || temporaryPassword(minLength());
    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    return db.withTransaction(async (c) => {
      const u = await staffRepository.insert(c, { username, passwordHash: hash, fullName, email, role, mustChangePassword: chosen ? mustChangePassword : true });
      if (!u) throw new HttpError(409, 'Tên đăng nhập đã tồn tại');
      await auditRepository.insert(c, { actorId: actor.id, action: 'STAFF_CREATE', targetType: 'STAFF', targetId: u.id, payload: { username, role, chosenPassword: Boolean(chosen) }, ip });
      // Mật khẩu do Admin tự đặt thì Admin đã biết -> không trả lại qua API.
      return { user: u, temporaryPassword: chosen ? null : password };
    });
  }

  async function update(id, { fullName, email, role, isActive, actor, ip }) {
    return db.withTransaction(async (c) => {
      const u = await staffRepository.findByIdForUpdate(c, id);
      if (!u) throw new HttpError(404, 'Không tìm thấy tài khoản');
      // Không để hệ thống mất quản trị viên cuối cùng.
      const demoting = u.role === 'SUPER_ADMIN' && ((role && role !== 'SUPER_ADMIN') || isActive === false);
      if (demoting && (await staffRepository.countActiveByRole(c, 'SUPER_ADMIN')) <= 1) {
        throw new HttpError(409, 'Không thể hạ quyền/khóa quản trị viên cuối cùng');
      }
      const updated = await staffRepository.update(c, id, { full_name: fullName, email, role, is_active: isActive });
      if (isActive === false || (role && role !== u.role)) await sessionRepository.removeAllForStaff(c, id);
      await auditRepository.insert(c, { actorId: actor.id, action: 'STAFF_UPDATE', targetType: 'STAFF', targetId: id, payload: { role, isActive }, ip });
      return updated;
    });
  }

  async function resetPassword(id, { actor, ip }) {
    const password = temporaryPassword(minLength());
    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    await db.withTransaction(async (c) => {
      const u = await staffRepository.findByIdForUpdate(c, id);
      if (!u) throw new HttpError(404, 'Không tìm thấy tài khoản');
      await staffRepository.update(c, id, { password_hash: hash, must_change_password: true, failed_login_attempts: 0, locked_until: null, password_changed_at: NOW });
      await sessionRepository.removeAllForStaff(c, id);
      await auditRepository.insert(c, { actorId: actor.id, action: 'STAFF_RESET_PASSWORD', targetType: 'STAFF', targetId: id, ip });
    });
    return { temporaryPassword: password };
  }

  /**
   * Admin đặt mật khẩu cụ thể cho tài khoản khác. Mật khẩu của chính mình phải đổi qua "Đổi mật khẩu"
   * (cần mật khẩu hiện tại) -> phiên bị đánh cắp không chiếm được tài khoản Admin.
   */
  async function setPassword(id, { newPassword, requireChange = true, actor, ip }) {
    if (Number(id) === Number(actor.id)) throw new HttpError(400, 'Đổi mật khẩu của chính bạn bằng nút "Đổi mật khẩu" ở góc trên');
    const hash = await db.withTransaction(async (c) => {
      const u = await staffRepository.findByIdForUpdate(c, id);
      if (!u) throw new HttpError(404, 'Không tìm thấy tài khoản');
      assertStrongPassword(newPassword, u.username, minLength());
      const h = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
      await staffRepository.update(c, id, {
        password_hash: h, must_change_password: Boolean(requireChange), failed_login_attempts: 0, locked_until: null, password_changed_at: NOW,
      });
      await sessionRepository.removeAllForStaff(c, id);
      await auditRepository.insert(c, { actorId: actor.id, action: 'STAFF_SET_PASSWORD', targetType: 'STAFF', targetId: id, payload: { requireChange: Boolean(requireChange) }, ip });
      return h;
    });
    return { ok: Boolean(hash), requireChange: Boolean(requireChange) };
  }

  /** Gỡ tạm khóa do nhập sai nhiều lần (khác "Khóa tài khoản" = is_active). */
  async function unlock(id, { actor, ip }) {
    return db.withTransaction(async (c) => {
      const u = await staffRepository.update(c, id, { failed_login_attempts: 0, locked_until: null });
      if (!u) throw new HttpError(404, 'Không tìm thấy tài khoản');
      await auditRepository.insert(c, { actorId: actor.id, action: 'STAFF_UNLOCK', targetType: 'STAFF', targetId: id, ip });
      return { ok: true };
    });
  }

  /** Đăng xuất tài khoản khỏi mọi thiết bị (nghi lộ mật khẩu, máy dùng chung). */
  async function logoutAll(id, { actor, ip }) {
    return db.withTransaction(async (c) => {
      const u = await staffRepository.findByIdForUpdate(c, id);
      if (!u) throw new HttpError(404, 'Không tìm thấy tài khoản');
      const { rowCount } = await sessionRepository.removeAllForStaff(c, id);
      await auditRepository.insert(c, { actorId: actor.id, action: 'STAFF_LOGOUT_ALL', targetType: 'STAFF', targetId: id, payload: { sessions: rowCount }, ip });
      return { ok: true, sessions: rowCount };
    });
  }

  return { create, update, resetPassword, setPassword, unlock, logoutAll, list: () => staffRepository.list(db) };
}

module.exports = { createStaffService, temporaryPassword, assertStrongPassword };
