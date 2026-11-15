'use strict';
/**
 * Che dữ liệu cá nhân TRƯỚC khi lưu log hay gửi lên LLM (thí sinh hay gõ SĐT, CCCD vào khung chat).
 * Thứ tự: email -> CCCD 12 số -> SĐT (để 12 số không bị bắt nhầm thành SĐT 10 số).
 */
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const CCCD = /(?<!\d)\d{12}(?!\d)/g;
const PHONE = /(?<![\d])(?:\+?84|0)(?:[\s.-]?\d){9,10}(?![\d])/g;

function maskPii(text) {
  const found = { email: 0, idNumber: 0, phone: 0 };
  const masked = String(text ?? '')
    .replace(EMAIL, () => { found.email += 1; return '[email]'; })
    .replace(CCCD, () => { found.idNumber += 1; return '[số giấy tờ]'; })
    .replace(PHONE, () => { found.phone += 1; return '[số điện thoại]'; });
  return { masked, found, hasPii: found.email + found.idNumber + found.phone > 0 };
}

// Cụm dẫn trước dữ liệu cá nhân ("số điện thoại của em là [số điện thoại]") cũng bỏ khi so khớp,
// nếu không câu hỏi sẽ trùng nhầm FAQ "Số điện thoại tư vấn tuyển sinh?".
const PII_LEADIN = /(s[ốo] đi[ệe]n tho[ạa]i|sđt|sdt|email|gmail|cccd|căn cước|zalo)?\s*(của\s+(em|mình|tôi|con|cháu)\s*)?(là\s*)?:?\s*\[(số điện thoại|email|số giấy tờ)\]/gi;

/** Văn bản dùng để so khớp/truy xuất: đã che PII và bỏ luôn cụm dẫn trước nó. */
const forMatching = (masked) => masked.replace(PII_LEADIN, ' ').replace(/\s{2,}/g, ' ').trim();

module.exports = { maskPii, forMatching };
