'use strict';
const express = require('express');
const v = require('../utils/validate');
const ah = require('../utils/asyncHandler');
const { requirePermission } = require('../middleware/auth');
const auditRepository = require('../repositories/auditRepository');
const jobRepository = require('../repositories/jobRepository');

module.exports = function adminConfigRoutes({ db, configService, llm }) {
  const r = express.Router();
  r.use(requirePermission('CONFIG'));
  r.get('/configs', (_req, res) => res.json({ configs: configService.list(), llmKeys: llm.keyStatus() }));
  r.put('/configs/:key', ah(async (req, res) => {
    const key = v.str(req.params, 'key', { required: true, max: 64, pattern: /^[A-Z][A-Z0-9_]*$/ });
    const row = await configService.update(key, v.str(req.body, 'value', { label: 'Giá trị', required: true, max: 2000 }), {
      actorId: req.user.id, ip: req.ip, reason: v.str(req.body, 'reason', { max: 500 }),
    });
    // Đổi model embedding -> vector cũ không còn so sánh được -> tạo lại toàn bộ.
    if (key === 'EMBEDDING_MODEL' || key === 'EMBEDDING_DIM') await jobRepository.enqueue(db, { type: 'REEMBED_ALL', payload: { reset: true } });
    res.json({ config: { key: row.key, value: row.value } });
  }));
  r.get('/audit', ah(async (req, res) => res.json({ items: await auditRepository.list(db, { limit: v.int(req.query, 'limit', { min: 1, max: 500 }) ?? 100 }) })));
  r.get('/jobs', ah(async (_req, res) => res.json({ items: await jobRepository.listRecent(db) })));
  return r;
};
