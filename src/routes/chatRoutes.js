'use strict';
/** Kênh trợ lý ảo trên website (widget). Thí sinh ẩn danh; session là UUID ngẫu nhiên. */
const express = require('express');
const v = require('../utils/validate');
const ah = require('../utils/asyncHandler');
const { uuid } = require('../utils/crypto');
const { HttpError } = require('../utils/httpError');
const chatRepository = require('../repositories/chatRepository');

module.exports = function chatRoutes({ db, answerService, handoffService, visitorHash, configService, limits }) {
  const r = express.Router();

  r.post('/sessions', ah(async (req, res) => {
    const s = await chatRepository.createSession(db, { id: uuid(), channel: 'WEB', visitorHash: visitorHash(req) });
    res.status(201).json({ sessionId: s.id, greeting: configService.get('CHAT_GREETING'), handoffEnabled: configService.get('HANDOFF_ENABLED') });
  }));

  r.post('/messages', limits.chat, ah(async (req, res) => {
    res.json(await answerService.answer({
      sessionId: v.uuid(req.body, 'sessionId', { label: 'Phiên trò chuyện', required: true }),
      message: v.str(req.body, 'message', { label: 'Câu hỏi', required: true, max: 1000 }),
      majorCode: v.str(req.body, 'majorCode', { max: 60, pattern: /^[A-Z0-9-]+$/ }),
    }));
  }));

  r.post('/messages/:id/rating', ah(async (req, res) => {
    const rating = v.int(req.body, 'rating', { label: 'Đánh giá', required: true, min: -1, max: 1 });
    if (rating === 0) throw new HttpError(400, 'Đánh giá chỉ nhận 1 hoặc -1');
    const row = await chatRepository.rate(db, {
      messageId: v.idParam(req.params), sessionId: v.uuid(req.body, 'sessionId', { required: true }), rating,
    });
    if (!row) throw new HttpError(404, 'Không tìm thấy câu trả lời');
    res.json({ ok: true });
  }));

  r.post('/handoff', limits.handoff, ah(async (req, res) => {
    res.status(201).json(await handoffService.create({
      sessionId: v.uuid(req.body, 'sessionId'),
      question: v.str(req.body, 'question', { label: 'Câu hỏi', required: true, min: 5, max: 2000 }),
      contactName: v.str(req.body, 'contactName', { label: 'Họ tên', max: 100 }),
      contactPhone: v.phone(req.body, 'contactPhone'),
      contactEmail: v.email(req.body, 'contactEmail'),
      consent: v.bool(req.body, 'consent', { fallback: false }),
    }));
  }));

  return r;
};
