'use strict';
const express = require('express');
const v = require('../utils/validate');
const ah = require('../utils/asyncHandler');
const { requirePermission } = require('../middleware/auth');
const { TOPICS } = require('../constants/catalog');
const { normalizeVi } = require('../utils/textNormalize');

const SOURCE = /^S\d{2}$/;

module.exports = function adminFaqRoutes({ faqService }) {
  const r = express.Router();
  const opts = (req) => ({ actor: req.user, ip: req.ip, reason: v.str(req.body, 'reason', { max: 500 }) });
  const body = (req, required) => ({
    question: v.str(req.body, 'question', { label: 'Câu hỏi', required, max: 500 }),
    answer: v.str(req.body, 'answer', { label: 'Câu trả lời', required, max: 4000 }),
    variants: req.body?.variants === undefined ? undefined : v.strArray(req.body, 'variants', { label: 'Cách hỏi khác', maxItems: 30, maxLength: 300 }),
    topic: v.oneOf(req.body, 'topic', Object.keys(TOPICS), { fallback: required ? 'KHAC' : undefined }),
    sourceCodes: req.body?.sourceCodes === undefined ? undefined : v.strArray(req.body, 'sourceCodes', { pattern: SOURCE }),
  });

  r.get('/', requirePermission('FAQ_EDIT'), ah(async (req, res) => res.json({
    items: await faqService.list({
      status: v.oneOf(req.query, 'status', ['DRAFT', 'APPROVED', 'ARCHIVED']),
      topic: v.oneOf(req.query, 'topic', Object.keys(TOPICS)),
      q: req.query.q ? normalizeVi(v.str(req.query, 'q', { max: 100 })) : null,
    }),
  })));
  r.post('/', requirePermission('FAQ_EDIT'), ah(async (req, res) => res.status(201).json({ faq: await faqService.create({ ...body(req, true), ...opts(req) }) })));
  r.put('/:id', requirePermission('FAQ_EDIT'), ah(async (req, res) => res.json({ faq: await faqService.update(v.idParam(req.params), { ...body(req, false), ...opts(req) }) })));
  r.post('/:id/approve', requirePermission('FAQ_APPROVE'), ah(async (req, res) => res.json({ faq: await faqService.approve(v.idParam(req.params), opts(req)) })));
  r.post('/:id/archive', requirePermission('FAQ_APPROVE'), ah(async (req, res) => res.json({ faq: await faqService.archive(v.idParam(req.params), opts(req)) })));
  r.post('/:id/restore', requirePermission('FAQ_APPROVE'), ah(async (req, res) => res.json({ faq: await faqService.restore(v.idParam(req.params), opts(req)) })));
  return r;
};
