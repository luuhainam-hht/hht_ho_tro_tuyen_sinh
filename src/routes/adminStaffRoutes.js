'use strict';
const express = require('express');
const v = require('../utils/validate');
const ah = require('../utils/asyncHandler');
const { requirePermission } = require('../middleware/auth');
const { ROLES } = require('../constants/roles');

module.exports = function adminStaffRoutes({ staffService }) {
  const r = express.Router();
  r.use(requirePermission('STAFF_MANAGEMENT'));
  r.get('/', ah(async (_req, res) => res.json({ items: await staffService.list() })));
  r.post('/', ah(async (req, res) => res.status(201).json(await staffService.create({
    username: v.str(req.body, 'username', { label: 'Tên đăng nhập', required: true, max: 50, pattern: /^[a-z0-9._-]{3,50}$/, patternMessage: 'Tên đăng nhập chỉ gồm chữ thường không dấu, số, dấu chấm, gạch' }),
    fullName: v.str(req.body, 'fullName', { label: 'Họ tên', required: true, max: 100 }),
    email: v.email(req.body, 'email'),
    role: v.oneOf(req.body, 'role', Object.keys(ROLES), { required: true, label: 'Vai trò' }),
    password: v.str(req.body, 'password', { label: 'Mật khẩu', max: 200 }) || null,
    mustChangePassword: v.bool(req.body, 'mustChangePassword') ?? true,
    actor: req.user, ip: req.ip,
  }))));
  r.put('/:id', ah(async (req, res) => res.json({
    user: await staffService.update(v.idParam(req.params), {
      fullName: v.str(req.body, 'fullName', { max: 100 }) ?? undefined,
      email: v.email(req.body, 'email') ?? undefined,
      role: v.oneOf(req.body, 'role', Object.keys(ROLES)) ?? undefined,
      isActive: v.bool(req.body, 'isActive') ?? undefined,
      actor: req.user, ip: req.ip,
    }),
  })));
  r.post('/:id/reset-password', ah(async (req, res) => res.json(await staffService.resetPassword(v.idParam(req.params), { actor: req.user, ip: req.ip }))));
  r.post('/:id/set-password', ah(async (req, res) => res.json(await staffService.setPassword(v.idParam(req.params), {
    newPassword: v.str(req.body, 'newPassword', { label: 'Mật khẩu mới', required: true, max: 200 }),
    requireChange: v.bool(req.body, 'requireChange') ?? true,
    actor: req.user, ip: req.ip,
  }))));
  r.post('/:id/unlock', ah(async (req, res) => res.json(await staffService.unlock(v.idParam(req.params), { actor: req.user, ip: req.ip }))));
  r.post('/:id/logout-all', ah(async (req, res) => res.json(await staffService.logoutAll(v.idParam(req.params), { actor: req.user, ip: req.ip }))));
  return r;
};
