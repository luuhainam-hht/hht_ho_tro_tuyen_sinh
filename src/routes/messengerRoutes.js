'use strict';
const express = require('express');
const { safeEqual } = require('../utils/crypto');

module.exports = function messengerRoutes({ messengerService, configService, env, logger }) {
  const r = express.Router();
  r.get('/webhook', (req, res) => {
    const ok = configService.get('MESSENGER_ENABLED') && req.query['hub.mode'] === 'subscribe'
      && env.MESSENGER_VERIFY_TOKEN && safeEqual(req.query['hub.verify_token'] || '', env.MESSENGER_VERIFY_TOKEN);
    return ok ? res.status(200).send(String(req.query['hub.challenge'] || '')) : res.status(403).json({ error: 'Xác minh webhook thất bại' });
  });
  r.post('/webhook', (req, res) => {
    if (!messengerService.verifySignature(req.rawBody, req.get('x-hub-signature-256'))) {
      return res.status(403).json({ error: 'Chữ ký không hợp lệ' });
    }
    res.status(200).json({ ok: true }); // trả ngay cho Meta, xử lý sau
    messengerService.process(req.body).catch((err) => logger.warn('[messenger]', err.message));
    return undefined;
  });
  return r;
};
