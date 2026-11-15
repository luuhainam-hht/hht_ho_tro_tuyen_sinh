'use strict';
const { HttpError } = require('./httpError');

const PASSWORD_MIN_LENGTH = 10;

/** Đủ dài + có chữ + có số; độ dài quan trọng hơn ký tự đặc biệt. minLength lấy từ PASSWORD_MIN_LENGTH (cấu hình). */
function assertStrongPassword(password, username = '', minLength = PASSWORD_MIN_LENGTH) {
  if (typeof password !== 'string' || password.length < minLength) {
    throw new HttpError(400, `Mật khẩu phải có ít nhất ${minLength} ký tự`);
  }
  if (password.length > 200) throw new HttpError(400, 'Mật khẩu không dài quá 200 ký tự');
  if (!/[A-Za-zÀ-ỹ]/.test(password) || !/\d/.test(password)) {
    throw new HttpError(400, 'Mật khẩu phải có cả chữ và số');
  }
  if (username && password.toLowerCase().includes(username.toLowerCase())) {
    throw new HttpError(400, 'Mật khẩu không được chứa tên đăng nhập');
  }
}

module.exports = { assertStrongPassword, PASSWORD_MIN_LENGTH };
