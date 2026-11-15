'use strict';
const { HttpError } = require('../utils/httpError');
const { PERMISSION_GROUPS } = require('../constants/roles');

function readBearer(req) {
  const m = /^Bearer\s+([a-f0-9]{64})$/.exec(req.get('authorization') || '');
  return m ? m[1] : null;
}

function requireAuth(authService, { allowPasswordChangePending = false } = {}) {
  return async (req, _res, next) => {
    try {
      const token = readBearer(req);
      const user = token ? await authService.resolveToken(token) : null;
      if (!user) throw new HttpError(401, 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn');
      // Tài khoản mới/được đặt lại mật khẩu: bắt đổi mật khẩu trước khi dùng chức năng khác.
      if (user.mustChangePassword && !allowPasswordChangePending) throw new HttpError(403, 'Bạn cần đổi mật khẩu trước khi tiếp tục', 'MUST_CHANGE_PASSWORD');
      req.user = user;
      req.authToken = token;
      next();
    } catch (err) { next(err); }
  };
}

function requirePermission(group) {
  const roles = PERMISSION_GROUPS[group];
  if (!roles) throw new Error(`Nhóm quyền không tồn tại: ${group}`);
  return (req, _res, next) => (req.user && roles.includes(req.user.role)
    ? next() : next(new HttpError(403, 'Bạn không có quyền thực hiện thao tác này')));
}

const hasPermission = (user, group) => Boolean(user && PERMISSION_GROUPS[group]?.includes(user.role));

module.exports = { readBearer, requireAuth, requirePermission, hasPermission };
