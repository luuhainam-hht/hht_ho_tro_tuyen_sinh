'use strict';
async function replaceForDocument(c, documentId, chunks) {
  await c.query('DELETE FROM kb_chunks WHERE document_id = ?', [documentId]);
  for (const ch of chunks) {
    await c.query(
      `INSERT INTO kb_chunks (document_id, chunk_index, heading_path, page_from, page_to, content, content_norm, token_count, embedding, embedding_model)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [documentId, ch.chunkIndex, ch.headingPath || '', ch.pageFrom ?? null, ch.pageTo ?? null, ch.content, ch.contentNorm,
        ch.tokenCount, ch.embedding ?? null, ch.embeddingModel ?? null],
    );
  }
}

/**
 * Đoạn seed dựng từ bảng ngành/hồ sơ/lịch/liên hệ (tài liệu không có tệp gốc) là ảnh chụp lúc nhập Excel.
 * Dữ liệu đó nay lấy trực tiếp từ CSDL (liveKnowledge) nên bỏ các đoạn seed này khỏi tìm kiếm để không
 * trả lời theo bản cũ khi Phòng Tuyển sinh đã sửa.
 */
const STALE_SEED_FILTER = `NOT (d.file_path IS NULL AND ch.heading_path ~ '^(Ngành nghề đào tạo|Hệ 9\\+ › Chỉ tiêu|Hồ sơ ›|Lịch tuyển sinh|Liên hệ)')`;

/**
 * Tìm kiếm toàn văn trên các đoạn thuộc tài liệu PUBLISHED có admission_year >= year. Truyền year = 0 để học
 * toàn bộ tài liệu đã công bố của mọi năm (RAG_ALL_YEARS) – năm học đi kèm mỗi đoạn để AI ưu tiên văn bản mới.
 * OR giữa các từ khóa (câu hỏi tự nhiên có nhiều từ thừa; AND sẽ trượt hết) + xếp hạng ts_rank_cd.
 */
async function fullTextSearch(c, { tokens, year, limit = 20 }) {
  const terms = [...new Set(tokens.filter((t) => /^[a-z0-9]+$/.test(t)))];
  if (!terms.length) return [];
  const { rows } = await c.query(
    `SELECT ch.id, ch.document_id, ch.heading_path, ch.content, ch.content_norm, ch.page_from, ch.page_to,
            d.title, d.source_url, d.source_code, d.doc_no, d.reliability, d.admission_year,
            ts_rank_cd(ch.tsv, q) AS rank
       FROM kb_chunks ch
       JOIN kb_documents d ON d.id = ch.document_id AND d.status = 'PUBLISHED' AND d.admission_year >= ?,
            to_tsquery('simple', ?) q
      WHERE ch.tsv @@ q AND ${STALE_SEED_FILTER}
      ORDER BY rank DESC, ch.id LIMIT ?`,
    [year, terms.join(' | '), limit],
  );
  return rows;
}

/** Toàn bộ embedding của kho đang công bố (cache ở retriever theo kb_version). */
async function listPublishedEmbeddings(c, year) {
  const { rows } = await c.query(
    `SELECT ch.id, ch.embedding FROM kb_chunks ch
       JOIN kb_documents d ON d.id = ch.document_id AND d.status = 'PUBLISHED' AND d.admission_year >= ?
      WHERE ch.embedding IS NOT NULL AND ${STALE_SEED_FILTER}`,
    [year],
  );
  return rows;
}

/** Văn bản chuẩn hóa của mọi đoạn đang dùng để tính tần suất từ (IDF) cho bước "có căn cứ". */
async function listPublishedNorms(c, year) {
  const { rows } = await c.query(
    `SELECT ch.content_norm, ch.heading_path, d.title FROM kb_chunks ch
       JOIN kb_documents d ON d.id = ch.document_id AND d.status = 'PUBLISHED' AND d.admission_year >= ?
      WHERE ${STALE_SEED_FILTER}`,
    [year],
  );
  return rows;
}

async function findByIds(c, ids) {
  if (!ids.length) return [];
  const { rows } = await c.query(
    `SELECT ch.id, ch.document_id, ch.heading_path, ch.content, ch.content_norm, ch.page_from, ch.page_to,
            d.title, d.source_url, d.source_code, d.doc_no, d.reliability, d.admission_year
       FROM kb_chunks ch JOIN kb_documents d ON d.id = ch.document_id WHERE ch.id = ANY(?::bigint[])`,
    [ids],
  );
  return rows;
}

const listForDocument = async (c, documentId) => (await c.query(
  'SELECT id, chunk_index, heading_path, page_from, page_to, token_count, content, (embedding IS NOT NULL) AS has_embedding FROM kb_chunks WHERE document_id = ? ORDER BY chunk_index',
  [documentId],
)).rows;

const listMissingEmbedding = async (c, limit = 50) => (await c.query(
  'SELECT id, content FROM kb_chunks WHERE embedding IS NULL ORDER BY id LIMIT ?', [limit],
)).rows;

const setEmbedding = (c, id, embedding, model) => c.query('UPDATE kb_chunks SET embedding = ?, embedding_model = ? WHERE id = ?', [embedding, model, id]);
const clearAllEmbeddings = (c) => c.query('UPDATE kb_chunks SET embedding = NULL, embedding_model = NULL');

module.exports = { STALE_SEED_FILTER, replaceForDocument, fullTextSearch, listPublishedEmbeddings, listPublishedNorms, findByIds, listForDocument, listMissingEmbedding, setEmbedding, clearAllEmbeddings };
