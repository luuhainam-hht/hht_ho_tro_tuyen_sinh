'use strict';
const { updateWhitelisted } = require('../utils/sqlUpdate');

const UPDATABLE = new Set(['title', 'doc_no', 'issued_date', 'admission_year', 'source_url', 'reliability', 'status',
  'error', 'chunk_count', 'replaces_document_id', 'published_by', 'published_at']);

async function insert(c, d) {
  const { rows } = await c.query(
    `INSERT INTO kb_documents (title, doc_no, issued_date, admission_year, source_url, file_name, file_path, file_sha256, mime,
                               status, uploaded_by, replaces_document_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?) RETURNING *`,
    [d.title, d.docNo ?? null, d.issuedDate ?? null, d.admissionYear, d.sourceUrl ?? null, d.fileName, d.filePath, d.sha256, d.mime,
      d.uploadedBy, d.replacesDocumentId ?? null],
  );
  return rows[0];
}

const findById = async (c, id) => (await c.query('SELECT * FROM kb_documents WHERE id = ?', [id])).rows[0] || null;
const findByIdForUpdate = async (c, id) => (await c.query('SELECT * FROM kb_documents WHERE id = ? FOR UPDATE', [id])).rows[0] || null;
const findBySha = async (c, sha) => (await c.query('SELECT id, title, status FROM kb_documents WHERE file_sha256 = ?', [sha])).rows[0] || null;
const update = (c, id, fields) => updateWhitelisted(c, { table: 'kb_documents', id, fields, allowed: UPDATABLE });

async function list(c, { status = null, year = null } = {}) {
  const { rows } = await c.query(
    `SELECT d.id, d.title, d.doc_no, d.source_code, d.issued_date, d.admission_year, d.source_url, d.reliability,
            d.file_name, d.mime, d.status, d.error, d.chunk_count, d.replaces_document_id, d.published_at, d.created_at,
            u.full_name AS uploaded_by_name, p.full_name AS published_by_name
       FROM kb_documents d
       LEFT JOIN staff u ON u.id = d.uploaded_by
       LEFT JOIN staff p ON p.id = d.published_by
      WHERE (?::text IS NULL OR d.status = ?) AND (?::int IS NULL OR d.admission_year = ?)
      ORDER BY (d.source_code IS NULL) DESC, d.created_at DESC, d.source_code, d.id DESC`,
    [status, status, year, year],
  );
  return rows;
}

const kbVersion = async (c) => (await c.query('SELECT kb_version FROM v_kb_version')).rows[0].kb_version;

module.exports = { insert, findById, findByIdForUpdate, findBySha, update, list, kbVersion };
