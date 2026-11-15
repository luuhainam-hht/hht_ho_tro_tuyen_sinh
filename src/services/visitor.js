'use strict';
/**
 * visitor_hash = HMAC(ngày VN, HMAC(secret, IP + User-Agent)) -> đếm được "một người" trong ngày
 * để giới hạn đặt lịch, nhưng không thể truy ngược IP và không nối được giữa các ngày.
 */
const { hmac } = require('../utils/crypto');
const { vnToday } = require('../utils/time');

function createVisitorHasher(secret) {
  return (req) => hmac(hmac(secret, vnToday()), `${req.ip}|${req.get('user-agent') || ''}`).slice(0, 32);
}

module.exports = { createVisitorHasher };
