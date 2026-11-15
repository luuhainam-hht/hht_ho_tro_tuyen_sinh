'use strict';
const express = require('express');
const v = require('../utils/validate');
const ah = require('../utils/asyncHandler');
const { requirePermission } = require('../middleware/auth');

module.exports = function adminAnalyticsRoutes({ analyticsService }) {
  const r = express.Router();
  r.use(requirePermission('ANALYTICS'));
  const range = (req) => ({ from: v.date(req.query, 'from'), to: v.date(req.query, 'to') });
  r.get('/summary', ah(async (req, res) => res.json(await analyticsService.summary(range(req)))));
  r.get('/unanswered', ah(async (req, res) => res.json(await analyticsService.unanswered(range(req)))));
  r.get('/missing-docs', ah(async (req, res) => res.json({ items: await analyticsService.missingDocs(range(req)) })));
  r.get('/export.xlsx', ah(async (req, res) => {
    const buf = await analyticsService.exportXlsx(range(req));
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="bao-cao-tu-van-tuyen-sinh.xlsx"');
    res.send(Buffer.from(buf));
  }));
  return r;
};
