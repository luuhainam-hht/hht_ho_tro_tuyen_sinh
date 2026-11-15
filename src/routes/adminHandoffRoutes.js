'use strict';
const express = require('express');
const v = require('../utils/validate');
const ah = require('../utils/asyncHandler');
const { requirePermission } = require('../middleware/auth');

module.exports = function adminHandoffRoutes({ handoffService }) {
  const r = express.Router();
  r.use(requirePermission('HANDOFF'));
  const o = (req) => ({ actor: req.user, ip: req.ip });
  r.get('/', ah(async (req, res) => res.json({ items: await handoffService.list({ status: v.oneOf(req.query, 'status', ['NEW', 'ASSIGNED', 'ANSWERED', 'CLOSED']) }) })));
  r.get('/:id', ah(async (req, res) => res.json(await handoffService.detail(v.idParam(req.params)))));
  r.post('/:id/assign', ah(async (req, res) => res.json(await handoffService.transition(v.idParam(req.params), 'ASSIGNED', { ...o(req), assignTo: v.int(req.body, 'staffId', { min: 1 }) }))));
  r.post('/:id/answer', ah(async (req, res) => res.json(await handoffService.transition(v.idParam(req.params), 'ANSWERED', {
    ...o(req), answer: v.str(req.body, 'answer', { label: 'Nội dung trả lời', required: true, max: 4000 }),
  }))));
  r.post('/:id/close', ah(async (req, res) => res.json(await handoffService.transition(v.idParam(req.params), 'CLOSED', o(req)))));
  r.post('/:id/promote', ah(async (req, res) => res.json({ faq: await handoffService.promoteToFaq(v.idParam(req.params), o(req)) })));
  return r;
};
