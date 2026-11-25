'use strict';
/**
 * Giới hạn tần suất (trust proxy = 1). Một cơ chế duy nhất – bản gốc có thêm Map tự viết cho chatbot.
 *
 * Khung chat giới hạn HAI lớp:
 *  - theo PHIÊN (sessionId + IP): một người gõ quá nhanh thì bị chậm lại;
 *  - theo IP với ngưỡng cao hơn nhiều: chặn kẻ tạo phiên mới liên tục.
 * Lý do: buổi tư vấn ở trường THCS/THPT hay phòng máy dùng chung một IP (NAT) cho hàng chục, hàng trăm thí sinh;
 * giới hạn 15 câu/phút/IP như trước sẽ chặn cả phòng.
 */
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

const MINUTE_MS = 60_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const LIMITS = Object.freeze({
  login: [15 * MINUTE_MS, 10, 'Bạn đăng nhập quá nhiều lần, vui lòng thử lại sau 15 phút.'],
  chatSession: [MINUTE_MS, 12, 'Bạn gửi câu hỏi quá nhanh, vui lòng chờ một phút.'],
  chatIp: [MINUTE_MS, 200, 'Mạng của bạn đang gửi quá nhiều câu hỏi, vui lòng thử lại sau ít phút.'],
  handoff: [60 * MINUTE_MS, 10, 'Bạn đã gửi nhiều câu hỏi cho cán bộ, vui lòng chờ phản hồi.'],
  recommend: [10 * MINUTE_MS, 20, 'Bạn làm bài gợi ý ngành quá nhiều lần, vui lòng thử lại sau.'],
  booking: [60 * MINUTE_MS, 5, 'Bạn đặt lịch quá nhiều lần trong 1 giờ.'],
  codeLookup: [10 * MINUTE_MS, 20, 'Bạn tra cứu mã hẹn quá nhiều lần, vui lòng thử lại sau.'],
  codeRecover: [30 * MINUTE_MS, 6, 'Bạn thử lấy lại mã hẹn quá nhiều lần, vui lòng thử lại sau 30 phút hoặc gọi hotline.'],
  upload: [60 * MINUTE_MS, 20, 'Bạn tải lên quá nhiều tài liệu trong 1 giờ.'],
  api: [MINUTE_MS, 600, 'Quá nhiều yêu cầu, vui lòng thử lại sau.'],
});

/** Khóa theo phiên: IP (đã gộp dải IPv6) + sessionId hợp lệ; thiếu sessionId thì chỉ theo IP. */
function sessionKey(req) {
  const ip = ipKeyGenerator(req.ip || '');
  const sid = String(req.body?.sessionId || '');
  return UUID.test(sid) ? `${ip}|${sid.toLowerCase()}` : ip;
}

const KEY_GENERATORS = { chatSession: sessionKey };

function createRateLimits({ enabled = true } = {}) {
  const out = {};
  for (const [name, [windowMs, limit, message]] of Object.entries(LIMITS)) {
    out[name] = enabled
      ? rateLimit({
        windowMs, limit, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: message },
        ...(KEY_GENERATORS[name] ? { keyGenerator: KEY_GENERATORS[name] } : {}),
      })
      : (_req, _res, next) => next();
  }
  // Giữ tên cũ `chat` cho các route: lớp IP trước, lớp phiên sau.
  out.chat = [out.chatIp, out.chatSession];
  return out;
}

module.exports = { createRateLimits, LIMITS, sessionKey };
