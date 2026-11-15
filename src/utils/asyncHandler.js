'use strict';
/** Express 4 không tự bắt lỗi của async handler -> bọc để lỗi đi vào errorHandler. */
module.exports = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
