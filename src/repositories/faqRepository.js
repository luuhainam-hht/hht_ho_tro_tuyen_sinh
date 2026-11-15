'use strict';
const { updateWhitelisted } = require('../utils/sqlUpdate');

const UPDATABLE = new Set(['topic', 'question', 'answer', 'variants', 'match_text_norm', 'embedding', 'embedding_model', 'applies_to',
  'source_codes', 'reliability', 'internal_note', 'document_id', 'admission_year', 'status', 'approved_by', 'approved_at']);

async function insert(c, f) {
  const { rows } = await c.query(
    `INSERT INTO faq_entries (code, topic, question, answer, variants, match_text_norm, applies_to, source_codes, reliability,
                              internal_note, document_id, admission_year, status, created_by)
     VALUES (?, ?, ?, ?, ?::jsonb, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
    [f.code ?? null, f.topic, f.question, f.answer, JSON.stringify(f.variants ?? []), f.matchTextNorm, f.appliesTo ?? null,
      f.sourceCodes ?? [], f.reliability ?? null, f.internalNote ?? null, f.documentId ?? null, f.admissionYear, f.status ?? 'DRAFT', f.createdBy ?? null],
  );
  return rows[0];
}

const findById = async (c, id) => (await c.query('SELECT * FROM faq_entries WHERE id = ?', [id])).rows[0] || null;
const findByIdForUpdate = async (c, id) => (await c.query('SELECT * FROM faq_entries WHERE id = ? FOR UPDATE', [id])).rows[0] || null;
const update = (c, id, fields) => updateWhitelisted(c, { table: 'faq_entries', id, fields, allowed: UPDATABLE });

/** FAQ đã duyệt của năm hiện hành (faqMatcher cache theo kb_version). */
const listApproved = async (c, year) => (await c.query(
  `SELECT f.id, f.code, f.topic, f.question, f.answer, f.variants, f.match_text_norm, f.embedding, f.source_codes, f.reliability,
          f.document_id, d.title AS document_title, d.source_url
     FROM faq_entries f LEFT JOIN kb_documents d ON d.id = f.document_id
    WHERE f.status = 'APPROVED' AND f.admission_year = ? ORDER BY f.code NULLS LAST, f.id`,
  [year],
)).rows;

async function list(c, { status = null, topic = null, q = null } = {}) {
  const { rows } = await c.query(
    `SELECT f.id, f.code, f.topic, f.question, f.answer, f.variants, f.applies_to, f.source_codes, f.reliability, f.internal_note,
            f.status, f.admission_year, f.approved_at, f.updated_at, (f.embedding IS NOT NULL) AS has_embedding,
            a.full_name AS approved_by_name
       FROM faq_entries f LEFT JOIN staff a ON a.id = f.approved_by
      WHERE (?::text IS NULL OR f.status = ?) AND (?::text IS NULL OR f.topic = ?)
        AND (?::text IS NULL OR f.match_text_norm LIKE '%' || ? || '%')
      ORDER BY f.code NULLS LAST, f.id DESC`,
    [status, status, topic, topic, q, q],
  );
  return rows;
}

const listMissingEmbedding = async (c, limit = 50) => (await c.query(
  "SELECT id, question, variants FROM faq_entries WHERE embedding IS NULL AND status = 'APPROVED' ORDER BY id LIMIT ?", [limit],
)).rows;

module.exports = { insert, findById, findByIdForUpdate, update, listApproved, list, listMissingEmbedding };
