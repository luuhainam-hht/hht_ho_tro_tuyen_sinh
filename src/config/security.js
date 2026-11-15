'use strict';
/**
 * Nguồn CSP, origin được gọi API. Tách khỏi server.js (bản gốc viết cứng tên miền trong khung).
 * Danh sách domain được NHÚNG widget nằm ở system_configs.ALLOWED_EMBED_ORIGINS (sửa qua Admin),
 * nên frame-ancestors của chat.html tính theo từng request.
 */
const list = (name) => (process.env[name] || '').split(',').map((s) => s.trim()).filter(Boolean);

const ALLOWED_ORIGINS = list('ALLOWED_ORIGINS');                  // origin ngoài được gọi API
const CSP_EXTRA = Object.freeze({
  connectSrc: list('CSP_CONNECT_SRC'),
  imgSrc: list('CSP_IMG_SRC'),
  frameSrc: list('CSP_FRAME_SRC'),                                   // ví dụ bản đồ nhúng
});
// Trang được phép chạy trong iframe trên website trường.
const EMBEDDABLE_PATHS = new Set(['/chat.html', '/chat']);

function createOriginChecker(allowed = ALLOWED_ORIGINS) {
  const set = new Set(allowed);
  return (origin, host) => {
    if (!origin) return true;
    if (set.has(origin)) return true;
    try { return new URL(origin).host === host; } catch { return false; }
  };
}

function buildCsp({ getEmbedOrigins, isProduction }) {
  return {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      scriptSrcAttr: ["'none'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'blob:', ...CSP_EXTRA.imgSrc],
      connectSrc: ["'self'", ...CSP_EXTRA.connectSrc],
      fontSrc: ["'self'"],
      frameSrc: ["'self'", ...CSP_EXTRA.frameSrc],
      workerSrc: ["'self'"],
      manifestSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: [(req) => (EMBEDDABLE_PATHS.has(req.path)
        ? ["'self'", ...getEmbedOrigins()].join(' ')
        : "'self'")],
      upgradeInsecureRequests: isProduction ? [] : null,
    },
  };
}

module.exports = { ALLOWED_ORIGINS, CSP_EXTRA, EMBEDDABLE_PATHS, createOriginChecker, buildCsp };
