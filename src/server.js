'use strict';
/**
 * Điểm vào HTTP + WebSocket (chung cổng) + frontend tĩnh.
 * Thứ tự middleware có chủ đích:
 *   helmet (CSP) → chặn origin lạ theo host → cors → json → rate-limit từng route
 *   → route cụ thể → route mount '/api' trần (SAU CÙNG) → static → 404 JSON/HTML → error handler
 * Khởi động: runMigrations → configService.loadAll → scheduler/jobRunner → listen. SIGTERM: tắt an toàn.
 */
const http = require('node:http');
const path = require('node:path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');

const { createContainer } = require('./container');
const { runMigrations } = require('./migrations/runMigrations');
const { buildCsp, ALLOWED_ORIGINS } = require('./config/security');
const originGuard = require('./middleware/originGuard');
const { requireAuth } = require('./middleware/auth');
const { createRateLimits } = require('./middleware/rateLimits');
const { notFound, errorHandler } = require('./middleware/errorHandler');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const JSON_BODY_LIMIT = '64kb';
const SHUTDOWN_TIMEOUT_MS = 8_000;
const STATIC_MAX_AGE_MS = 60 * 60 * 1000;

function createApp(c) {
  const app = express();
  const limits = createRateLimits({ enabled: c.env.RATE_LIMIT_ENABLED });
  const deps = { ...c, limits };
  app.disable('x-powered-by');
  app.set('trust proxy', c.env.TRUST_PROXY);

  app.use(helmet({
    contentSecurityPolicy: buildCsp({
      getEmbedOrigins: () => { try { return c.configService.get('ALLOWED_EMBED_ORIGINS'); } catch { return []; } },
      isProduction: c.env.NODE_ENV === 'production',
    }),
    crossOriginEmbedderPolicy: false,
    // Mặc định helmet đặt X-Frame-Options: SAMEORIGIN -> chặn nhúng widget; CSP frame-ancestors đã kiểm soát thay.
    frameguard: false,
  }));
  app.use(originGuard(c.isOriginAllowed));
  app.use(cors({ origin: (o, cb) => cb(null, ALLOWED_ORIGINS.includes(o)), allowedHeaders: ['Content-Type', 'Authorization'], maxAge: 600 }));
  // rawBody: Messenger ký HMAC trên byte gốc của body.
  app.use(express.json({ limit: JSON_BODY_LIMIT, verify: (req, _res, buf) => { if (req.originalUrl.startsWith('/api/messenger')) req.rawBody = buf; } }));

  app.use('/api/auth/login', limits.login);
  app.use('/api', limits.api);

  const staff = requireAuth(c.authService);
  app.use('/api/auth', require('./routes/authRoutes')(deps));
  app.use('/api/chat', require('./routes/chatRoutes')(deps));
  app.use('/api/handbook', require('./routes/handbookRoutes')(deps));
  app.use('/api/recommend', require('./routes/recommendRoutes')(deps));
  app.use('/api/appointments', require('./routes/appointmentRoutes')(deps));
  app.use('/api/messenger', require('./routes/messengerRoutes')(deps));
  app.use('/api/admin/kb', staff, require('./routes/adminKbRoutes')(deps));
  app.use('/api/admin/faq', staff, require('./routes/adminFaqRoutes')(deps));
  app.use('/api/admin/catalog', staff, require('./routes/adminMajorRoutes')(deps));
  app.use('/api/admin/handoffs', staff, require('./routes/adminHandoffRoutes')(deps));
  app.use('/api/admin/analytics', staff, require('./routes/adminAnalyticsRoutes')(deps));
  app.use('/api/admin/appointments', staff, require('./routes/adminAppointmentRoutes')(deps));
  app.use('/api/admin/staff', staff, require('./routes/adminStaffRoutes')(deps));
  app.use('/api/admin/system', staff, require('./routes/adminConfigRoutes')(deps));
  app.use('/api/admin/ai', staff, require('./routes/adminAiRoutes')(deps));
  app.use('/api', require('./routes/publicRoutes')(deps)); // mount trần: luôn SAU CÙNG

  app.use(express.static(PUBLIC_DIR, {
    extensions: ['html'],
    maxAge: STATIC_MAX_AGE_MS,
    setHeaders(res, filePath) {
      // HTML + sw.js luôn kiểm tra bản mới, nếu không người dùng kẹt bản cũ sau khi deploy.
      if (/\.(html|webmanifest)$/.test(filePath) || filePath.endsWith('sw.js')) res.setHeader('Cache-Control', 'no-cache');
    },
  }));
  app.use(notFound);
  app.use(errorHandler(c.logger));
  return app;
}

async function start() {
  const c = createContainer();
  const { logger, env } = c;
  await runMigrations(c.db, { logger });
  logger.info(`[boot] nạp ${await c.configService.loadAll()} tham số cấu hình`);
  await c.refreshMajors();
  // Khóa API do Admin thêm (lưu mã hóa). Lỗi ở đây không được chặn khởi động: vẫn còn khóa .env / FAQ.
  try { await c.aiKeyService.reload(); } catch (err) { logger.warn('[boot] không nạp được khóa API từ CSDL:', err.message); }
  await c.pgBus.start(c.onBusEvent);
  if (env.SCHEDULER_ENABLED) c.scheduler.start();
  if (env.JOB_RUNNER_ENABLED) c.jobRunner.start();
  if (!c.llm.available()) logger.warn('[boot] Chưa có khóa Gemini (thêm ở trang Quản trị > Cài đặt AI hoặc GEMINI_API_KEYS) hoặc AI đang tắt: trợ lý trả lời bằng FAQ + trích dẫn văn bản.');

  const server = http.createServer(createApp(c));
  c.wsHub.attach(server);
  await new Promise((r) => server.listen(env.PORT, r));
  logger.info(`[boot] HHT Tuyển sinh AI chạy tại cổng ${env.PORT} (instance ${env.INSTANCE_ID})`);

  let stopping = false;
  async function shutdown(signal) {
    if (stopping) return;
    stopping = true;
    logger.info(`[shutdown] nhận ${signal}, dừng nhận kết nối mới…`);
    setTimeout(() => { logger.error('[shutdown] quá thời gian, buộc thoát'); process.exit(1); }, SHUTDOWN_TIMEOUT_MS).unref();
    try {
      await c.scheduler.stop();
      await c.jobRunner.stop();
      await c.wsHub.close();
      await new Promise((r) => server.close(r));
      await c.pgBus.stop();
      await c.db.end();
      logger.info('[shutdown] đã tắt an toàn');
      process.exit(0);
    } catch (err) {
      logger.error('[shutdown] lỗi:', err);
      process.exit(1);
    }
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  return { server, container: c };
}

if (require.main === module) {
  start().catch((err) => { console.error('[boot] khởi động thất bại:', err); process.exit(1); });
}

module.exports = { createApp, start };
