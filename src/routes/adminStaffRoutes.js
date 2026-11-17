'use strict';
const express = require('express');
const v = require('../utils/validate');
const ah = require('../utils/asyncHandler');
const { requirePermission } = require('../middleware/auth');
const { ROLES } = require('../constants/roles');
const { HttpError } = require('../utils/httpError');

module.exports = function adminStaffRoutes({ staffService }) {
  const r = express.Router();
  r.use(requirePermission('STAFF_MANAGEMENT'));
  r.get('/', ah(async (_req, res) => res.json({ items: await staffService.list() })));
  r.post('/', ah(async (req, res) => res.status(201).json(await staffService.create({
    username: v.str(req.body, 'username', { label: 'Tên đăng nhập', required: true, max: 50, pattern: /^[a-z0-9._-]{3,50}$/, patternMessage: 'Tên đăng nhập chỉ gồm chữ thường không dấu, số, dấu chấm, gạch' }),
    fullName: v.str(req.body, 'fullName', { label: 'Họ tên', required: true, max: 100 }),
    email: v.email(req.body, 'email'),
    role: v.oneOf(req.body, 'role', Object.keys(ROLES), { required: true, label: 'Vai trò' }),
    faculty: v.str(req.body, 'faculty', { label: 'Khoa', max: 100 }) || null,
    password: v.str(req.body, 'password', { label: 'Mật khẩu', max: 200 }) || null,
    mustChangePassword: v.bool(req.body, 'mustChangePassword') ?? true,
    actor: req.user, ip: req.ip,
  }))));
  r.put('/:id', ah(async (req, res) => res.json({
    user: await staffService.update(v.idParam(req.params), {
      fullName: v.str(req.body, 'fullName', { max: 100 }) ?? undefined,
      email: v.email(req.body, 'email') ?? undefined,
      role: v.oneOf(req.body, 'role', Object.keys(ROLES)) ?? undefined,
      faculty: req.body?.faculty === undefined ? undefined : (v.str(req.body, 'faculty', { label: 'Khoa', max: 100 }) || null),
      isActive: v.bool(req.body, 'isActive') ?? undefined,
      actor: req.user, ip: req.ip,
    }),
  })));
  /**
   * Xuất Excel: { mode: 'LIST' } danh sách (không mật khẩu – mật khẩu băm một chiều, không xem lại được);
   * { mode: 'NEW_PASSWORDS', ids: [...], confirm: true } cấp mật khẩu tạm mới cho tài khoản đã chọn và ghi vào tệp.
   */
  r.post('/export.xlsx', ah(async (req, res) => {
    const mode = v.oneOf(req.body, 'mode', ['LIST', 'NEW_PASSWORDS'], { label: 'Kiểu xuất' }) || 'LIST';
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter((x) => Number.isInteger(Number(x)) && Number(x) > 0) : [];
    if (mode === 'NEW_PASSWORDS' && req.body?.confirm !== true) throw new HttpError(400, 'Cần xác nhận: cấp mật khẩu tạm mới sẽ làm mật khẩu cũ hết hiệu lực');
    const out = await staffService.exportWorkbook({ mode, ids, actor: req.user, ip: req.ip });
    const day = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${out.withPasswords ? 'mat-khau-tam-can-bo' : 'tai-khoan-can-bo'}-${day}.xlsx"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(out.buffer);
  }));
  r.post('/:id/reset-password', ah(async (req, res) => res.json(await staffService.resetPassword(v.idParam(req.params), { actor: req.user, ip: req.ip }))));
  r.post('/:id/set-password', ah(async (req, res) => res.json(await staffService.setPassword(v.idParam(req.params), {
    newPassword: v.str(req.body, 'newPassword', { label: 'Mật khẩu mới', required: true, max: 200 }),
    requireChange: v.bool(req.body, 'requireChange') ?? true,
    actor: req.user, ip: req.ip,
  }))));
  r.delete('/:id', ah(async (req, res) => res.json(await staffService.remove(v.idParam(req.params), { actor: req.user, ip: req.ip }))));
  r.post('/:id/unlock', ah(async (req, res) => res.json(await staffService.unlock(v.idParam(req.params), { actor: req.user, ip: req.ip }))));
  r.post('/:id/logout-all', ah(async (req, res) => res.json(await staffService.logoutAll(v.idParam(req.params), { actor: req.user, ip: req.ip }))));
  return r;
};
