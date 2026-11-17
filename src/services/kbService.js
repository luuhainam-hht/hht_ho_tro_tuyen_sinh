'use strict';
/**
 * Quản lý vòng đời tài liệu kho tri thức:
 *   DRAFT -> PROCESSING -> READY -> PUBLISHED -> ARCHIVED   (FAILED khi trích xuất lỗi)
 * Chỉ SUPER_ADMIN/LEADER được PUBLISH (route kiểm tra quyền); publish bản thay thế thì bản cũ ARCHIVED.
 * Publish/archive làm v_kb_version đổi -> cache câu trả lời và cache FAQ tự hết hiệu lực.
 */
const fs = require('node:fs/promises');
const path = require('node:path');
const { HttpError } = require('../utils/httpError');
const { sha256 } = require('../utils/crypto');
const { NOW } = require('../utils/sqlUpdate');
const { mimeFromName, SUPPORTED_MIME } = require('./rag/extractor');
const kbDocumentRepository = require('../repositories/kbDocumentRepository');
const auditRepository = require('../repositories/auditRepository');
const jobRepository = require('../repositories/jobRepository');

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

function createKbService({ db, configService, broadcast, uploadDir }) {
  async function upload({ file, meta, actor, ip }) {
    if (!file) throw new HttpError(400, 'Chưa chọn tệp tài liệu');
    if (file.size > MAX_UPLOAD_BYTES) throw new HttpError(413, 'Tệp vượt quá 20 MB');
    const mime = mimeFromName(file.originalname);
    if (!mime || !SUPPORTED_MIME.has(mime)) throw new HttpError(400, 'Chỉ hỗ trợ tệp PDF, DOCX, XLSX, CSV, TXT, MD hoặc ảnh JPG/PNG/WEBP');
    const hash = sha256(file.buffer);
    const dup = await kbDocumentRepository.findBySha(db, hash);
    if (dup) throw new HttpError(409, `Tài liệu này đã được tải lên trước đó: "${dup.title}" (${dup.status})`);

    await fs.mkdir(uploadDir, { recursive: true });
    const storedName = `${hash}${path.extname(file.originalname).toLowerCase()}`;
    await fs.writeFile(path.join(uploadDir, storedName), file.buffer);

    const doc = await db.withTransaction(async (c) => {
      if (meta.replacesDocumentId) {
        const old = await kbDocumentRepository.findById(c, meta.replacesDocumentId);
        if (!old) throw new HttpError(400, 'Tài liệu được thay thế không tồn tại');
      }
      const d = await kbDocumentRepository.insert(c, {
        ...meta, admissionYear: meta.admissionYear ?? configService.get('CURRENT_ADMISSION_YEAR'),
        fileName: file.originalname, filePath: storedName, sha256: hash, mime, uploadedBy: actor.id,
      });
      await jobRepository.enqueue(c, { type: 'INGEST_DOCUMENT', payload: { documentId: Number(d.id) } });
      await auditRepository.insert(c, { actorId: actor.id, action: 'KB_UPLOAD', targetType: 'KB_DOCUMENT', targetId: d.id, payload: { title: d.title, file: file.originalname }, ip });
      return d;
    });
    broadcast('KB_DOCUMENT_UPDATED', { id: Number(doc.id), status: doc.status });
    return doc;
  }

  async function transition(id, { actor, ip, to, from, reason = null, extra = {} }) {
    const result = await db.withTransaction(async (c) => {
      const d = await kbDocumentRepository.findByIdForUpdate(c, id);
      if (!d) throw new HttpError(404, 'Không tìm thấy tài liệu');
      if (!from.includes(d.status)) throw new HttpError(409, `Tài liệu đang ở trạng thái ${d.status}, không thể chuyển sang ${to}`);
      const updated = await kbDocumentRepository.update(c, id, { status: to, ...extra });
      const archived = [];
      if (to === 'PUBLISHED' && d.replaces_document_id) {
        const old = await kbDocumentRepository.findByIdForUpdate(c, d.replaces_document_id);
        if (old && old.status === 'PUBLISHED') {
          await kbDocumentRepository.update(c, old.id, { status: 'ARCHIVED' });
          archived.push(Number(old.id));
        }
      }
      await auditRepository.insert(c, {
        actorId: actor.id, action: `KB_${to}`, targetType: 'KB_DOCUMENT', targetId: id, reason, payload: { from: d.status, to, archived }, ip,
      });
      return { doc: updated, archived };
    });
    broadcast('KB_DOCUMENT_UPDATED', { id: Number(id), status: to, archived: result.archived });
    return result.doc;
  }

  const publish = (id, opts) => transition(id, { ...opts, to: 'PUBLISHED', from: ['READY', 'ARCHIVED'], extra: { published_by: opts.actor.id, published_at: NOW } });
  const archive = (id, opts) => transition(id, { ...opts, to: 'ARCHIVED', from: ['PUBLISHED', 'READY'] });

  async function reprocess(id, { actor, ip }) {
    return db.withTransaction(async (c) => {
      const d = await kbDocumentRepository.findByIdForUpdate(c, id);
      if (!d) throw new HttpError(404, 'Không tìm thấy tài liệu');
      if (!d.file_path) throw new HttpError(409, 'Tài liệu nhập từ bộ dữ liệu không có tệp gốc để xử lý lại');
      if (!['FAILED', 'READY', 'DRAFT'].includes(d.status)) throw new HttpError(409, 'Chỉ xử lý lại tài liệu chưa công bố');
      await jobRepository.enqueue(c, { type: 'INGEST_DOCUMENT', payload: { documentId: Number(id) } });
      await auditRepository.insert(c, { actorId: actor.id, action: 'KB_REPROCESS', targetType: 'KB_DOCUMENT', targetId: id, ip });
      return { queued: true };
    });
  }

  /**
   * "Học lại toàn bộ": xử lý lại mọi tài liệu lỗi/chưa xử lý có tệp gốc (vd: bản scan trước đây báo lỗi, nay AI
   * đọc được) và bổ sung vector còn thiếu cho đoạn văn bản + FAQ.
   */
  async function relearnAll({ actor, ip }) {
    return db.withTransaction(async (c) => {
      const { rows } = await c.query("SELECT id FROM kb_documents WHERE status IN ('FAILED', 'DRAFT') AND file_path IS NOT NULL ORDER BY id");
      for (const r of rows) await jobRepository.enqueue(c, { type: 'INGEST_DOCUMENT', payload: { documentId: Number(r.id) } });
      await jobRepository.enqueue(c, { type: 'REEMBED_ALL', payload: { reset: false } });
      await auditRepository.insert(c, { actorId: actor.id, action: 'KB_RELEARN', targetType: 'SYSTEM', targetId: null, payload: { documents: rows.length }, ip });
      return { requeued: rows.length };
    });
  }

  return { upload, publish, archive, reprocess, relearnAll, MAX_UPLOAD_BYTES };
}

module.exports = { createKbService, MAX_UPLOAD_BYTES };
