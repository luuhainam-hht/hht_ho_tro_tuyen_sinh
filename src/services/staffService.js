'use strict';
const bcrypt = require('bcryptjs');
const crypto = require('node:crypto');
const { HttpError } = require('../utils/httpError');
const { assertStrongPassword } = require('../utils/passwordPolicy');
const staffRepository = require('../repositories/staffRepository');
const sessionRepository = require('../repositories/sessionRepository');
const auditRepository = require('../repositories/auditRepository');
const { BCRYPT_ROUNDS } = require('./authService');

/** Mật khẩu tạm dễ đọc qua điện thoại: 12 ký tự, bỏ ký tự dễ nhầm. */
function temporaryPassword() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < 10; i += 1) s += alphabet[crypto.randomInt(alphabet.length)];
  return `${s}${crypto.randomInt(10, 99)}`;
}

function createStaffService({ db }) {
  async function create({ username, fullName, email, role, actor, ip }) {
    const password = temporaryPassword();
    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    return db.withTransaction(async (c) => {
      const u = await staffRepository.insert(c, { username, passwordHash: hash, fullName, email, role, mustChangePassword: true });
      if (!u) throw new HttpError(409, 'Tên đăng nhập đã tồn tại');
      await auditRepository.insert(c, { actorId: actor.id, action: 'STAFF_CREATE', targetType: 'STAFF', targetId: u.id, payload: { username, role }, ip });
      return { user: u, temporaryPassword: password };
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
    const password = temporaryPassword();
    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    await db.withTransaction(async (c) => {
      const u = await staffRepository.findByIdForUpdate(c, id);
      if (!u) throw new HttpError(404, 'Không tìm thấy tài khoản');
      await staffRepository.update(c, id, { password_hash: hash, must_change_password: true, failed_login_attempts: 0, locked_until: null });
      await sessionRepository.removeAllForStaff(c, id);
      await auditRepository.insert(c, { actorId: actor.id, action: 'STAFF_RESET_PASSWORD', targetType: 'STAFF', targetId: id, ip });
    });
    return { temporaryPassword: password };
  }

  return { create, update, resetPassword, list: () => staffRepository.list(db) };
}

module.exports = { createStaffService, temporaryPassword, assertStrongPassword };
