'use strict';
const crypto = require('node:crypto');

const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');
const hmac = (secret, data) => crypto.createHmac('sha256', secret).update(data).digest('hex');
const uuid = () => crypto.randomUUID();

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

module.exports = { sha256, hmac, uuid, safeEqual };
