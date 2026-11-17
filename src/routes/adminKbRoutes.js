'use strict';
const express = require('express');
const multer = require('multer');
const v = require('../utils/validate');
const ah = require('../utils/asyncHandler');
const { HttpError } = require('../utils/httpError');
const { requirePermission } = require('../middleware/auth');
const { MAX_UPLOAD_BYTES } = require('../services/kbService');
const kbDocumentRepository = require('../repositories/kbDocumentRepository');
const kbChunkRepository = require('../repositories/kbChunkRepository');
const jobRepository = require('../repositories/jobRepository');

// Bộ nhớ RAM (không ghi tạm ra đĩa): cần băm sha256 trước để từ chối file trùng.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } });

module.exports = function adminKbRoutes({ db, kbService, limits }) {
  const r = express.Router();
  r.get('/', requirePermission('KB_VIEW'), ah(async (req, res) => res.json({
    documents: await kbDocumentRepository.list(db, { status: v.str(req.query, 'status', { max: 20 }), year: v.int(req.query, 'year') }),
    kbVersion: await kbDocumentRepository.kbVersion(db),
  })));
  /** Trợ lý đã học được gì: tài liệu theo trạng thái, số đoạn, đoạn đã có vector, tài liệu lỗi cần xử lý. */
  r.get('/coverage', requirePermission('KB_VIEW'), ah(async (_req, res) => {
    const [{ rows: byStatus }, { rows: chunks }, { rows: failed }, { rows: faq }] = await Promise.all([
      db.query('SELECT status, COUNT(*)::int AS n FROM kb_documents GROUP BY status'),
      db.query(`SELECT COUNT(*)::int AS total, COUNT(ch.embedding)::int AS embedded
                  FROM kb_chunks ch JOIN kb_documents d ON d.id = ch.document_id AND d.status = 'PUBLISHED'`),
      db.query("SELECT id, title, error FROM kb_documents WHERE status IN ('FAILED', 'DRAFT') ORDER BY id DESC LIMIT 20"),
      db.query("SELECT COUNT(*)::int AS total, COUNT(embedding)::int AS embedded FROM faq_entries WHERE status = 'APPROVED'"),
    ]);
    res.json({ byStatus: Object.fromEntries(byStatus.map((x) => [x.status, x.n])), chunks: chunks[0], faq: faq[0], pending: failed });
  }));
  r.post('/relearn', requirePermission('KB_MANAGE'), ah(async (req, res) => res.json(await kbService.relearnAll({ actor: req.user, ip: req.ip }))));
  r.get('/:id', requirePermission('KB_VIEW'), ah(async (req, res) => {
    const doc = await kbDocumentRepository.findById(db, v.idParam(req.params));
    if (!doc) throw new HttpError(404, 'Không tìm thấy tài liệu');
    res.json({ document: doc, chunks: await kbChunkRepository.listForDocument(db, doc.id) });
  }));
  r.post('/', requirePermission('KB_MANAGE'), limits.upload, upload.single('file'), ah(async (req, res) => {
    const doc = await kbService.upload({
      file: req.file, actor: req.user, ip: req.ip,
      meta: {
        title: v.str(req.body, 'title', { label: 'Tên tài liệu', required: true, max: 300 }),
        docNo: v.str(req.body, 'docNo', { label: 'Số văn bản', max: 100 }),
        issuedDate: v.date(req.body, 'issuedDate', { label: 'Ngày ban hành' }),
        sourceUrl: v.str(req.body, 'sourceUrl', { max: 500, pattern: /^https?:\/\//, patternMessage: 'Đường dẫn nguồn phải bắt đầu bằng http(s)://' }),
        admissionYear: v.int(req.body, 'admissionYear', { min: 2020, max: 2100 }),
        replacesDocumentId: v.int(req.body, 'replacesDocumentId', { min: 1 }),
      },
    });
    res.status(201).json({ document: doc });
  }));
  r.post('/:id/publish', requirePermission('KB_PUBLISH'), ah(async (req, res) => res.json({
    document: await kbService.publish(v.idParam(req.params), { actor: req.user, ip: req.ip, reason: v.str(req.body, 'reason', { max: 500 }) }),
  })));
  r.post('/:id/archive', requirePermission('KB_PUBLISH'), ah(async (req, res) => res.json({
    document: await kbService.archive(v.idParam(req.params), { actor: req.user, ip: req.ip, reason: v.str(req.body, 'reason', { max: 500 }) }),
  })));
  r.post('/:id/reprocess', requirePermission('KB_MANAGE'), ah(async (req, res) => res.json(await kbService.reprocess(v.idParam(req.params), { actor: req.user, ip: req.ip }))));
  r.post('/reembed', requirePermission('CONFIG'), ah(async (req, res) => {
    const job = await jobRepository.enqueue(db, { type: 'REEMBED_ALL', payload: { reset: v.bool(req.body, 'reset', { fallback: false }) } });
    res.json({ queued: Boolean(job) });
  }));
  return r;
};
