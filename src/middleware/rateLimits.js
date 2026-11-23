'use strict';
/** Giới hạn tần suất theo IP (trust proxy = 1). Một cơ chế duy nhất – bản gốc có thêm Map tự viết cho chatbot. */
const { rateLimit } = require('express-rate-limit');

const MINUTE_MS = 60_000;
const LIMITS = Object.freeze({
  login: [15 * MINUTE_MS, 10, 'Bạn đăng nhập quá nhiều lần, vui lòng thử lại sau 15 phút.'],
  chat: [MINUTE_MS, 15, 'Bạn gửi câu hỏi quá nhanh, vui lòng chờ một phút.'],
  handoff: [60 * MINUTE_MS, 10, 'Bạn đã gửi nhiều câu hỏi cho cán bộ, vui lòng chờ phản hồi.'],
  recommend: [10 * MINUTE_MS, 20, 'Bạn làm bài gợi ý ngành quá nhiều lần, vui lòng thử lại sau.'],
  booking: [60 * MINUTE_MS, 5, 'Bạn đặt lịch quá nhiều lần trong 1 giờ.'],
  codeLookup: [10 * MINUTE_MS, 20, 'Bạn tra cứu mã hẹn quá nhiều lần, vui lòng thử lại sau.'],
  codeRecover: [30 * MINUTE_MS, 6, 'Bạn thử lấy lại mã hẹn quá nhiều lần, vui lòng thử lại sau 30 phút hoặc gọi hotline.'],
  upload: [60 * MINUTE_MS, 20, 'Bạn tải lên quá nhiều tài liệu trong 1 giờ.'],
  api: [MINUTE_MS, 300, 'Quá nhiều yêu cầu, vui lòng thử lại sau.'],
});

function createRateLimits({ enabled = true } = {}) {
  const out = {};
  for (const [name, [windowMs, limit, message]] of Object.entries(LIMITS)) {
    out[name] = enabled
      ? rateLimit({ windowMs, limit, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: message } })
      : (_req, _res, next) => next();
  }
  return out;
}

module.exports = { createRateLimits, LIMITS };
