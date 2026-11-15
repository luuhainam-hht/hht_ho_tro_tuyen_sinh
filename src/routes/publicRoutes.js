'use strict';
/** Mount trần tại '/api' -> đăng ký SAU CÙNG để không chặn route cụ thể. Không yêu cầu đăng nhập. */
const express = require('express');
const ah = require('../utils/asyncHandler');

module.exports = function publicRoutes({ db, handbookService, llm, pgBusState, wsHub }) {
  const r = express.Router();
  r.get('/health', (_req, res) => res.json({ status: 'ok' }));
  r.get('/health/deep', ah(async (_req, res) => {
    const started = Date.now();
    await db.query('SELECT 1');
    res.json({
      status: 'ok', dbLatencyMs: Date.now() - started, realtimeBus: pgBusState(), wsClients: wsHub.clientCount(),
      llm: { configured: llm.available() },
    });
  }));
  r.get('/meta', (_req, res) => res.json(handbookService.meta()));
  return r;
};
