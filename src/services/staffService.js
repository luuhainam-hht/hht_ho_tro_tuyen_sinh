'use strict';
const bcrypt = require('bcryptjs');
const crypto = require('node:crypto');
const ExcelJS = require('exceljs');
const { ROLE_LABEL_VI } = require('../constants/roles');
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

/** Cán bộ Khoa bắt buộc gắn đúng một khoa; vai trò khác không gắn khoa (tránh hiểu nhầm phạm vi quyền). */
function resolveFaculty(role, faculty) {
  if (role !== 'FACULTY') return null;
  const f = String(faculty || '').trim();
  if (!f) throw new HttpError(400, 'Cán bộ Khoa phải chọn khoa phụ trách');
  return f.slice(0, 100);
}

function createStaffService({ db, configService = null }) {
  const minLength = () => securityPolicy(configService).passwordMinLength;

  async function create({ username, fullName, email, role, faculty = null, password: chosen = null, mustChangePassword = true, actor, ip }) {
    const fac = resolveFaculty(role, faculty);
    if (chosen) assertStrongPassword(chosen, username, minLength());
    const password = chosen || temporaryPassword(minLength());
    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    return db.withTransaction(async (c) => {
      const u = await staffRepository.insert(c, { username, passwordHash: hash, fullName, email, role, faculty: fac, mustChangePassword: chosen ? mustChangePassword : true });
      if (!u) throw new HttpError(409, 'Tên đăng nhập đã tồn tại');
      await auditRepository.insert(c, { actorId: actor.id, action: 'STAFF_CREATE', targetType: 'STAFF', targetId: u.id, payload: { username, role, faculty: fac, chosenPassword: Boolean(chosen) }, ip });
      // Mật khẩu do Admin tự đặt thì Admin đã biết -> không trả lại qua API.
      return { user: u, temporaryPassword: chosen ? null : password };
    });
  }

  async function update(id, { fullName, email, role, faculty, isActive, actor, ip }) {
    return db.withTransaction(async (c) => {
      const u = await staffRepository.findByIdForUpdate(c, id);
      if (!u) throw new HttpError(404, 'Không tìm thấy tài khoản');
      // Không để hệ thống mất quản trị viên cuối cùng.
      const demoting = u.role === 'SUPER_ADMIN' && ((role && role !== 'SUPER_ADMIN') || isActive === false);
      if (demoting && (await staffRepository.countActiveByRole(c, 'SUPER_ADMIN')) <= 1) {
        throw new HttpError(409, 'Không thể hạ quyền/khóa quản trị viên cuối cùng');
      }
      // Đổi vai trò hoặc khoa -> tính lại khoa; chỉ gửi khoa (không đổi vai trò) thì áp cho vai trò hiện tại.
      const nextRole = role || u.role;
      const fac = role !== undefined || faculty !== undefined ? resolveFaculty(nextRole, faculty !== undefined ? faculty : u.faculty) : undefined;
      const updated = await staffRepository.update(c, id, { full_name: fullName, email, role, faculty: fac, is_active: isActive });
      const scopeChanged = (role && role !== u.role) || (fac !== undefined && (fac || null) !== (u.faculty || null));
      if (isActive === false || scopeChanged) await sessionRepository.removeAllForStaff(c, id);
      await auditRepository.insert(c, { actorId: actor.id, action: 'STAFF_UPDATE', targetType: 'STAFF', targetId: id, payload: { role, faculty: fac, isActive }, ip });
      // RETURNING * có password_hash -> trả bản chỉ gồm cột công khai.
      return updated ? staffRepository.findById(c, id) : null;
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

  /**
   * Xuất tài khoản cán bộ ra Excel.
   *  - mode LIST: danh sách tài khoản, KHÔNG có mật khẩu. Mật khẩu chỉ lưu dạng băm bcrypt (một chiều):
   *    không ai, kể cả Quản trị, xem lại được mật khẩu cũ – đây là yêu cầu bảo mật, không phải thiếu sót.
   *  - mode NEW_PASSWORDS: cấp mật khẩu tạm MỚI cho các tài khoản được chọn (trừ chính mình), ghi vào file để
   *    phát cho cán bộ. Mật khẩu cũ hết hiệu lực, cán bộ bị đăng xuất và phải đổi mật khẩu ở lần đăng nhập đầu.
   */
  async function exportWorkbook({ mode = 'LIST', ids = [], actor, ip }) {
    const issued = new Map();
    let rows;
    if (mode === 'NEW_PASSWORDS') {
      const targets = [...new Set(ids.map(Number))].filter((id) => id !== Number(actor.id));
      if (!targets.length) throw new HttpError(400, 'Chọn ít nhất một tài khoản (không tính tài khoản của bạn) để cấp mật khẩu tạm');
      if (targets.length > 200) throw new HttpError(400, 'Mỗi lần cấp tối đa 200 tài khoản');
      const plan = await Promise.all(targets.map(async (id) => {
        const password = temporaryPassword(minLength());
        return { id, password, hash: await bcrypt.hash(password, BCRYPT_ROUNDS) };
      }));
      await db.withTransaction(async (c) => {
        for (const p of plan) {
          const u = await staffRepository.findByIdForUpdate(c, p.id);
          if (!u) throw new HttpError(404, `Không tìm thấy tài khoản #${p.id}`);
          await staffRepository.update(c, p.id, { password_hash: p.hash, must_change_password: true, failed_login_attempts: 0, locked_until: null, password_changed_at: NOW });
          await sessionRepository.removeAllForStaff(c, p.id);
          issued.set(p.id, p.password);
        }
        await auditRepository.insert(c, { actorId: actor.id, action: 'STAFF_EXPORT_PASSWORDS', targetType: 'STAFF', targetId: null, payload: { count: plan.length, ids: targets }, ip });
      });
      rows = (await staffRepository.list(db)).filter((u) => issued.has(Number(u.id)));
    } else {
      rows = await staffRepository.list(db);
      await auditRepository.insert(db, { actorId: actor.id, action: 'STAFF_EXPORT', targetType: 'STAFF', targetId: null, payload: { count: rows.length }, ip });
    }

    const withPw = mode === 'NEW_PASSWORDS';
    const fmt = (d) => (d ? new Date(d).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) : '');
    const status = (u) => (!u.is_active ? 'Đã khóa' : u.locked_until && new Date(u.locked_until) > new Date() ? 'Tạm khóa (nhập sai)' : 'Hoạt động');
    const wb = new ExcelJS.Workbook();
    wb.creator = 'HHT Tuyển sinh';
    wb.created = new Date();
    const ws = wb.addWorksheet('Tài khoản cán bộ', { views: [{ state: 'frozen', ySplit: 3 }] });
    const cols = [
      ['STT', 6], ['Tên đăng nhập', 20], ...(withPw ? [['Mật khẩu tạm', 20]] : []), ['Họ tên', 26], ['Vai trò', 20], ['Khoa', 26],
      ['Email', 28], ['Trạng thái', 18], ['Đăng nhập gần nhất', 20], ['Đổi mật khẩu gần nhất', 20],
    ];
    ws.columns = cols.map(([, width]) => ({ width }));
    ws.mergeCells(1, 1, 1, cols.length);
    ws.getCell(1, 1).value = withPw
      ? `MẬT KHẨU TẠM CẤP NGÀY ${fmt(new Date())} – TÀI LIỆU MẬT: phát riêng từng người, xóa tệp sau khi phát. Cán bộ phải đổi mật khẩu ở lần đăng nhập đầu.`
      : `DANH SÁCH TÀI KHOẢN CÁN BỘ – xuất ngày ${fmt(new Date())}. Mật khẩu được mã hóa một chiều nên không có trong tệp; cần mật khẩu thì dùng "Cấp mật khẩu tạm & xuất Excel".`;
    ws.getCell(1, 1).font = { bold: true, color: { argb: withPw ? 'FFC8102E' : 'FF1F2937' } };
    ws.getCell(1, 1).alignment = { wrapText: true, vertical: 'middle' };
    ws.getRow(1).height = 36;
    const head = ws.getRow(3);
    cols.forEach(([label], i) => {
      const cell = head.getCell(i + 1);
      cell.value = label;
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC8102E' } };
      cell.alignment = { vertical: 'middle', wrapText: true };
    });
    rows.forEach((u, i) => {
      const r = ws.addRow([
        i + 1, u.username, ...(withPw ? [issued.get(Number(u.id))] : []), u.full_name, ROLE_LABEL_VI[u.role] || u.role, u.faculty || '',
        u.email || '', status(u), fmt(u.last_login_at), fmt(u.password_changed_at),
      ]);
      if (withPw) r.getCell(3).font = { name: 'Consolas', bold: true };
    });
    ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: cols.length } };
    const buffer = await wb.xlsx.writeBuffer();
    return { buffer: Buffer.from(buffer), count: rows.length, withPasswords: withPw };
  }

  return { create, update, resetPassword, setPassword, unlock, logoutAll, exportWorkbook, list: () => staffRepository.list(db) };
}

module.exports = { createStaffService, temporaryPassword, assertStrongPassword };
