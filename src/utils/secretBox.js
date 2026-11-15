'use strict';
/**
 * Mã hóa đối xứng AES-256-GCM cho bí mật lưu trong CSDL (khóa API AI).
 * Định dạng: v1:<iv base64url>:<tag base64url>:<dữ liệu base64url>. GCM phát hiện dữ liệu bị sửa / sai khóa.
 * Vì sao không lưu khóa API dạng thô: bản sao lưu CSDL (pg_dump, Neon) không được làm lộ khóa trả phí.
 */
const crypto = require('node:crypto');

const PREFIX = 'v1';

function createSecretBox(secret) {
  if (!secret) throw new Error('Thiếu khóa mã hóa (SECRET_ENCRYPTION_KEY / VISITOR_HASH_SECRET)');
  const key = crypto.createHash('sha256').update(`hht-ts:secret-box:${secret}`).digest();

  function encrypt(plain) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const data = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
    return [PREFIX, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join(':');
  }

  /** Trả null nếu không giải mã được (đổi khóa bí mật, dữ liệu hỏng) – nơi gọi tự xử lý. */
  function decrypt(box) {
    const parts = String(box || '').split(':');
    if (parts.length !== 4 || parts[0] !== PREFIX) return null;
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(parts[1], 'base64url'));
      decipher.setAuthTag(Buffer.from(parts[2], 'base64url'));
      return Buffer.concat([decipher.update(Buffer.from(parts[3], 'base64url')), decipher.final()]).toString('utf8');
    } catch {
      return null;
    }
  }

  return { encrypt, decrypt };
}

/** "AIzaSyD...xk3Q" -> "AIza…xk3Q" để nhận diện mà không lộ khóa. */
const maskSecret = (s) => (String(s).length <= 8 ? '••••' : `${String(s).slice(0, 4)}…${String(s).slice(-4)}`);

module.exports = { createSecretBox, maskSecret };
