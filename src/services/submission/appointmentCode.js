'use strict';
/**
 * Mã hẹn HS-XXXX-XXXX, bảng chữ Crockford Base32 (bỏ I, L, O, U): đọc qua điện thoại không nhầm.
 * 32^8 ≈ 1,1 nghìn tỷ tổ hợp -> không đoán được mã của người khác.
 */
const crypto = require('node:crypto');

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_PATTERN = /^HS-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;

function generate() {
  let s = '';
  for (let i = 0; i < 8; i += 1) s += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return `HS-${s.slice(0, 4)}-${s.slice(4)}`;
}

/** Chấp nhận chữ thường, thiếu gạch, khoảng trắng; đọc nhầm O->0, I/L->1. Trả null nếu không hợp lệ. */
function normalize(input) {
  let s = String(input || '').toUpperCase().replace(/[\s-]/g, '');
  if (s.startsWith('HS')) s = s.slice(2);
  s = s.replace(/O/g, '0').replace(/[IL]/g, '1');
  if (!/^[0-9A-HJKMNP-TV-Z]{8}$/.test(s)) return null;
  return `HS-${s.slice(0, 4)}-${s.slice(4)}`;
}

module.exports = { generate, normalize, ALPHABET, CODE_PATTERN };
