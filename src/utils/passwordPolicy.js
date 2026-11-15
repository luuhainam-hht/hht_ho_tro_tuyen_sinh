'use strict';
const { HttpError } = require('./httpError');

const PASSWORD_MIN_LENGTH = 10;

/** Đủ dài + có chữ + có số; độ dài quan trọng hơn ký tự đặc biệt. */
function assertStrongPassword(password, username = '') {
  if (typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH) {
    throw new HttpError(400, `Mật khẩu phải có ít nhất ${PASSWORD_MIN_LENGTH} ký tự`);
  }
  if (!/[A-Za-zÀ-ỹ]/.test(password) || !/\d/.test(password)) {
    throw new HttpError(400, 'Mật khẩu phải có cả chữ và số');
  }
  if (username && password.toLowerCase().includes(username.toLowerCase())) {
    throw new HttpError(400, 'Mật khẩu không được chứa tên đăng nhập');
  }
}

module.exports = { assertStrongPassword, PASSWORD_MIN_LENGTH };
