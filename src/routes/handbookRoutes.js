'use strict';
/** M3 – Cẩm nang tuyển sinh số (công khai, chỉ đọc). */
const express = require('express');
const v = require('../utils/validate');
const ah = require('../utils/asyncHandler');
const { LEVELS, AUDIENCES } = require('../constants/catalog');

module.exports = function handbookRoutes({ handbookService }) {
  const r = express.Router();
  r.get('/overview', ah(async (_req, res) => res.json(await handbookService.overview())));
  r.get('/majors', ah(async (req, res) => res.json({
    majors: await handbookService.listMajors({
      level: v.oneOf(req.query, 'level', Object.keys(LEVELS)),
      faculty: v.str(req.query, 'faculty', { max: 100 }),
      q: v.str(req.query, 'q', { max: 100 }),
      support: v.oneOf(req.query, 'support', ['STATE', 'ENTERPRISE']),
    }),
  })));
  r.get('/majors/:code', ah(async (req, res) => res.json({ major: await handbookService.majorDetail(v.str(req.params, 'code', { required: true, max: 60 })) })));
  r.get('/checklist', ah(async (req, res) => res.json({
    items: await handbookService.checklist({
      audience: v.oneOf(req.query, 'audience', Object.keys(AUDIENCES), { required: true, label: 'Đối tượng' }),
      majorCode: v.str(req.query, 'majorCode', { max: 60 }),
    }),
  })));
  r.get('/schedule', ah(async (_req, res) => res.json({ items: await handbookService.schedule() })));
  r.get('/contacts', ah(async (_req, res) => res.json({ items: await handbookService.contacts() })));
  r.get('/guide', ah(async (_req, res) => res.json({ steps: await handbookService.guideSteps() })));
  r.get('/faq', ah(async (_req, res) => res.json({ items: await handbookService.faqByTopic() })));
  r.get('/sources', ah(async (_req, res) => res.json({ items: await handbookService.sources() })));
  return r;
};
