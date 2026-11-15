'use strict';
const path = require('node:path');
const { HttpError } = require('../utils/httpError');

const NOT_FOUND_PAGE = path.join(__dirname, '..', '..', 'public', '404.html');

function notFound(req, res) {
  if (req.path.startsWith('/api/') || req.path === '/api') return res.status(404).json({ error: 'Không tìm thấy tài nguyên' });
  return res.status(404).sendFile(NOT_FOUND_PAGE);
}

function errorHandler(logger = console) {
  // eslint-disable-next-line no-unused-vars
  return (err, req, res, _next) => {
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: err.message, ...(err.code ? { code: err.code } : {}), ...(err.details ? { details: err.details } : {}) });
    }
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Dữ liệu JSON không hợp lệ' });
    if (err.type === 'entity.too.large' || err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'Dữ liệu gửi lên quá lớn' });
    if (err.code === '23514') return res.status(409).json({ error: 'Dữ liệu vi phạm ràng buộc, thao tác bị từ chối' });
    logger.error('[http] lỗi không mong đợi:', req.method, req.originalUrl, err);
    return res.status(500).json({ error: 'Lỗi máy chủ, vui lòng thử lại sau' });
  };
}

module.exports = { notFound, errorHandler };
