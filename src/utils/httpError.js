'use strict';
/** Lỗi nghiệp vụ có mã HTTP. Thông điệp luôn bằng tiếng Việt, an toàn để trả cho client. */
class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

module.exports = { HttpError };
