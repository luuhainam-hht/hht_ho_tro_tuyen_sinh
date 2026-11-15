'use strict';
const express = require('express');
const v = require('../utils/validate');
const ah = require('../utils/asyncHandler');
const { HttpError } = require('../utils/httpError');
const recommendationRepository = require('../repositories/recommendationRepository');

module.exports = function recommendRoutes({ db, recommendService, visitorHash, limits }) {
  const r = express.Router();
  r.get('/questionnaire', (_req, res) => res.json(recommendService.questionnaire()));
  r.post('/', limits.recommend, ah(async (req, res) => {
    res.json(await recommendService.recommend({
      answers: req.body?.answers, sessionId: v.uuid(req.body, 'sessionId'), visitorHash: visitorHash(req),
    }));
  }));
  r.get('/:id', ah(async (req, res) => {
    const row = await recommendationRepository.findById(db, v.uuid(req.params, 'id', { required: true }));
    if (!row) throw new HttpError(404, 'Không tìm thấy kết quả gợi ý');
    res.json(row);
  }));
  return r;
};
