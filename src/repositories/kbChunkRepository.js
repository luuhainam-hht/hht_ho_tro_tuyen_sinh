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
 * Tìm kiếm toàn văn trên các đoạn thuộc tài liệu PUBLISHED của năm hiện hành.
 * OR giữa các từ khóa (câu hỏi tự nhiên có nhiều từ thừa; AND sẽ trượt hết) + xếp hạng ts_rank_cd.
 */
async function fullTextSearch(c, { tokens, year, limit = 20 }) {
  const terms = [...new Set(tokens.filter((t) => /^[a-z0-9]+$/.test(t)))];
  if (!terms.length) return [];
  const { rows } = await c.query(
    `SELECT ch.id, ch.document_id, ch.heading_path, ch.content, ch.content_norm, ch.page_from, ch.page_to,
            d.title, d.source_url, d.source_code, d.doc_no, d.reliability,
            ts_rank_cd(ch.tsv, q) AS rank
       FROM kb_chunks ch
       JOIN kb_documents d ON d.id = ch.document_id AND d.status = 'PUBLISHED' AND d.admission_year = ?,
            to_tsquery('simple', ?) q
      WHERE ch.tsv @@ q
      ORDER BY rank DESC, ch.id LIMIT ?`,
    [year, terms.join(' | '), limit],
  );
  return rows;
}

/** Toàn bộ embedding của kho đang công bố (cache ở retriever theo kb_version). */
async function listPublishedEmbeddings(c, year) {
  const { rows } = await c.query(
    `SELECT ch.id, ch.embedding FROM kb_chunks ch
       JOIN kb_documents d ON d.id = ch.document_id AND d.status = 'PUBLISHED' AND d.admission_year = ?
      WHERE ch.embedding IS NOT NULL`,
    [year],
  );
  return rows;
}

async function findByIds(c, ids) {
  if (!ids.length) return [];
  const { rows } = await c.query(
    `SELECT ch.id, ch.document_id, ch.heading_path, ch.content, ch.content_norm, ch.page_from, ch.page_to,
            d.title, d.source_url, d.source_code, d.doc_no, d.reliability
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

module.exports = { replaceForDocument, fullTextSearch, listPublishedEmbeddings, findByIds, listForDocument, listMissingEmbedding, setEmbedding, clearAllEmbeddings };
