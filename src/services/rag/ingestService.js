'use strict';
/**
 * M2 – Nạp tri thức: tài liệu DRAFT -> (job INGEST_DOCUMENT) -> trích xuất -> chia đoạn -> embed -> READY.
 * Embed là tùy chọn: chưa có API key thì đoạn vẫn dùng được cho tìm kiếm từ khóa; job REEMBED_ALL
 * bổ sung vector sau khi cấu hình key hoặc đổi EMBEDDING_MODEL.
 */
const path = require('node:path');
const { extract } = require('./extractor');
const { chunkLines } = require('./chunker');
const kbDocumentRepository = require('../../repositories/kbDocumentRepository');
const kbChunkRepository = require('../../repositories/kbChunkRepository');
const faqRepository = require('../../repositories/faqRepository');
const { normalizeVi } = require('../../utils/textNormalize');

function createIngestService({ db, llm, broadcast, uploadDir, logger = console }) {
  async function processDocument(documentId) {
    const doc = await db.withTransaction(async (c) => {
      const d = await kbDocumentRepository.findByIdForUpdate(c, documentId);
      if (!d) throw new Error(`Không tìm thấy tài liệu ${documentId}`);
      if (!['DRAFT', 'FAILED', 'READY', 'PROCESSING'].includes(d.status)) {
        throw new Error(`Tài liệu đang ở trạng thái ${d.status}, không xử lý lại`);
      }
      return kbDocumentRepository.update(c, documentId, { status: 'PROCESSING', error: null });
    });
    broadcast('KB_DOCUMENT_UPDATED', { id: documentId, status: 'PROCESSING' });

    try {
      const lines = await extract(path.resolve(uploadDir, doc.file_path), doc.mime);
      const chunks = chunkLines(lines);
      if (!chunks.length) throw new Error('Không trích được nội dung chữ (tài liệu scan ảnh cần OCR trước khi tải lên)');
      let model = null;
      if (llm.available()) {
        try {
          const vectors = await llm.embed(chunks.map((ch) => `${ch.headingPath}\n${ch.content}`));
          model = llm.modelName();
          chunks.forEach((ch, i) => { ch.embedding = vectors[i]; ch.embeddingModel = model; });
        } catch (err) {
          logger.warn(`[ingest] embed tài liệu ${documentId} lỗi, lưu không vector:`, err.message);
        }
      }
      await db.withTransaction(async (c) => {
        await kbChunkRepository.replaceForDocument(c, documentId, chunks);
        await kbDocumentRepository.update(c, documentId, { status: 'READY', chunk_count: chunks.length, error: null });
      });
      broadcast('KB_DOCUMENT_UPDATED', { id: documentId, status: 'READY', chunkCount: chunks.length });
      return { chunks: chunks.length, embedded: Boolean(model) };
    } catch (err) {
      await kbDocumentRepository.update(db, documentId, { status: 'FAILED', error: String(err.message).slice(0, 1000) }).catch(() => {});
      broadcast('KB_DOCUMENT_UPDATED', { id: documentId, status: 'FAILED' });
      throw err;
    }
  }

  /** Bổ sung vector cho đoạn và FAQ chưa có (sau khi thêm key hoặc đổi model). */
  async function reembedMissing({ reset = false } = {}) {
    if (!llm.available()) return { skipped: 'Chưa cấu hình API key' };
    if (reset) {
      await kbChunkRepository.clearAllEmbeddings(db);
      await db.query('UPDATE faq_entries SET embedding = NULL, embedding_model = NULL');
    }
    let chunkCount = 0;
    for (;;) {
      const batch = await kbChunkRepository.listMissingEmbedding(db, 50);
      if (!batch.length) break;
      const vectors = await llm.embed(batch.map((b) => b.content));
      for (let i = 0; i < batch.length; i += 1) await kbChunkRepository.setEmbedding(db, batch[i].id, vectors[i], llm.modelName());
      chunkCount += batch.length;
    }
    let faqCount = 0;
    for (;;) {
      const batch = await faqRepository.listMissingEmbedding(db, 50);
      if (!batch.length) break;
      // Embed câu hỏi + biến thể: khớp theo ý hỏi, không theo đáp án.
      const vectors = await llm.embed(batch.map((f) => [f.question, ...(f.variants || [])].join('\n')), 'RETRIEVAL_QUERY');
      for (let i = 0; i < batch.length; i += 1) {
        await faqRepository.update(db, batch[i].id, { embedding: vectors[i], embedding_model: llm.modelName() });
      }
      faqCount += batch.length;
    }
    return { chunkCount, faqCount };
  }

  return { processDocument, reembedMissing, normalize: normalizeVi };
}

module.exports = { createIngestService };
