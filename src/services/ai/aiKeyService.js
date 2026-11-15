'use strict';
/**
 * Quản lý khóa API AI trên giao diện (không phải sửa .env, không khởi động lại):
 *   - khóa lưu MÃ HÓA (secretBox), API chỉ trả 4 ký tự đầu/cuối
 *   - thêm / đổi tên / bật-tắt / xóa -> nạp lại pool của bản chạy này + phát AI_KEYS_UPDATED qua pgBus
 *     để các bản chạy khác cũng nạp lại
 *   - khóa trong .env vẫn chạy song song (không sửa được từ giao diện)
 */
const { HttpError } = require('../../utils/httpError');
const { sha256 } = require('../../utils/crypto');
const { createSecretBox, maskSecret } = require('../../utils/secretBox');
const aiKeyRepository = require('../../repositories/aiKeyRepository');
const auditRepository = require('../../repositories/auditRepository');

const KEY_PATTERN = /^[A-Za-z0-9_-]{20,200}$/;

function createAiKeyService({ db, llm, secret, broadcast = () => {}, logger = console }) {
  const box = createSecretBox(secret);
  let undecryptable = [];

  /** Đọc khóa đang bật, giải mã, nạp vào pool. Khóa không giải mã được (đổi bí mật) bị bỏ qua và báo trên giao diện. */
  async function reload() {
    const rows = await aiKeyRepository.listActiveSecrets(db);
    const keys = [];
    undecryptable = [];
    for (const r of rows) {
      const key = box.decrypt(r.key_cipher);
      if (key) keys.push({ key, label: r.label, id: Number(r.id), source: 'ADMIN' });
      else undecryptable.push(Number(r.id));
    }
    if (undecryptable.length) logger.warn(`[aiKeys] ${undecryptable.length} khóa không giải mã được (đã đổi SECRET_ENCRYPTION_KEY/VISITOR_HASH_SECRET?) – nhập lại trên trang Cài đặt AI`);
    return llm.setKeys(keys);
  }

  async function changed() {
    await reload();
    broadcast('AI_KEYS_UPDATED', {});
  }

  async function list() {
    const rows = await aiKeyRepository.list(db);
    const status = new Map(llm.keyStatus().filter((s) => s.source === 'ADMIN').map((s) => [s.id, s]));
    return rows.map((r) => ({ ...r, id: Number(r.id), undecryptable: undecryptable.includes(Number(r.id)), pool: status.get(Number(r.id)) || null }));
  }

  async function add({ label, apiKey, actor, ip }) {
    const key = String(apiKey || '').trim();
    if (!KEY_PATTERN.test(key)) throw new HttpError(400, 'Khóa API không đúng định dạng (chỉ gồm chữ, số, "-", "_", dài 20–200 ký tự)');
    const row = await db.withTransaction(async (c) => {
      const r = await aiKeyRepository.insert(c, { label, keyCipher: box.encrypt(key), keyHash: sha256(key), keyHint: maskSecret(key), createdBy: actor.id });
      if (!r) throw new HttpError(409, 'Khóa API này đã có trong danh sách');
      await auditRepository.insert(c, { actorId: actor.id, action: 'AI_KEY_ADD', targetType: 'AI_KEY', targetId: r.id, payload: { label, hint: r.key_hint }, ip });
      return r;
    });
    await changed();
    return row;
  }

  async function update(id, { label, isActive, actor, ip }) {
    const row = await db.withTransaction(async (c) => {
      const r = await aiKeyRepository.update(c, id, { label, is_active: isActive });
      if (!r) throw new HttpError(404, 'Không tìm thấy khóa API');
      await auditRepository.insert(c, { actorId: actor.id, action: 'AI_KEY_UPDATE', targetType: 'AI_KEY', targetId: id, payload: { label, isActive }, ip });
      return r;
    });
    await changed();
    return row;
  }

  async function remove(id, { actor, ip }) {
    await db.withTransaction(async (c) => {
      const r = await aiKeyRepository.remove(c, id);
      if (!r) throw new HttpError(404, 'Không tìm thấy khóa API');
      await auditRepository.insert(c, { actorId: actor.id, action: 'AI_KEY_DELETE', targetType: 'AI_KEY', targetId: id, payload: { label: r.label, hint: r.key_hint }, ip });
    });
    await changed();
    return { ok: true };
  }

  /** Thử một khóa đã lưu, ghi kết quả lần thử cuối. Lỗi ghi kết quả không ảnh hưởng kết quả trả về. */
  async function test(id) {
    const r = await aiKeyRepository.findSecret(db, id);
    if (!r) throw new HttpError(404, 'Không tìm thấy khóa API');
    const key = box.decrypt(r.key_cipher);
    const result = key ? await llm.testKey(key) : { ok: false, message: 'Không giải mã được khóa (đã đổi khóa bí mật của máy chủ). Hãy xóa và nhập lại.' };
    await aiKeyRepository.update(db, id, { last_test_at: new Date(), last_test_ok: result.ok, last_test_message: result.message.slice(0, 300) })
      .catch((err) => logger.warn('[aiKeys] không ghi được kết quả thử:', err.message));
    return result;
  }

  /** Thử khóa mới trước khi lưu (không ghi gì vào CSDL). */
  async function testRaw(apiKey) {
    const key = String(apiKey || '').trim();
    if (!KEY_PATTERN.test(key)) throw new HttpError(400, 'Khóa API không đúng định dạng');
    return llm.testKey(key);
  }

  return { reload, list, add, update, remove, test, testRaw };
}

module.exports = { createAiKeyService, KEY_PATTERN };
