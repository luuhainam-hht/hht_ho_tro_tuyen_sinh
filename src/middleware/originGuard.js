'use strict';
/** Chặn request có Origin lạ TRƯỚC cors(): cors chỉ bỏ header, request POST vẫn chạy (CSRF chéo site). */
const { HttpError } = require('../utils/httpError');

module.exports = (isOriginAllowed) => (req, _res, next) => (isOriginAllowed(req.get('origin'), req.get('host'))
  ? next() : next(new HttpError(403, 'Nguồn truy cập không được phép')));
