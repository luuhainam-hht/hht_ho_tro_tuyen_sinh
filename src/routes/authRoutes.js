'use strict';
const express = require('express');
const v = require('../utils/validate');
const ah = require('../utils/asyncHandler');
const { requireAuth } = require('../middleware/auth');

module.exports = function authRoutes({ authService }) {
  const r = express.Router();
  const authAny = requireAuth(authService, { allowPasswordChangePending: true });

  r.post('/login', ah(async (req, res) => {
    const username = v.str(req.body, 'username', { label: 'Tên đăng nhập', required: true, max: 50 }).toLowerCase();
    const password = v.str(req.body, 'password', { label: 'Mật khẩu', required: true, max: 200 });
    res.json(await authService.login({ username, password, ip: req.ip, userAgent: req.get('user-agent') || null }));
  }));
  r.post('/logout', authAny, ah(async (req, res) => { await authService.logout(req.authToken); res.json({ ok: true }); }));
  r.get('/me', authAny, (req, res) => res.json({ user: req.user }));
  r.post('/change-password', authAny, ah(async (req, res) => {
    res.json(await authService.changePassword({
      actor: req.user, token: req.authToken, ip: req.ip,
      currentPassword: v.str(req.body, 'currentPassword', { label: 'Mật khẩu hiện tại', required: true, max: 200 }),
      newPassword: v.str(req.body, 'newPassword', { label: 'Mật khẩu mới', required: true, max: 200 }),
    }));
  }));
  return r;
};
