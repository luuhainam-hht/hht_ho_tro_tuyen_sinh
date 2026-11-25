'use strict';
/**
 * Composition root: lắp ráp mọi phụ thuộc một lần. Service nhận phụ thuộc qua tham số -> test thay
 * DB/LLM giả dễ dàng; server và CLI (scripts/) dùng chung một cách lắp.
 */
const path = require('node:path');
const env = require('./config/env');
const { getDb } = require('./config/db');
const { createConfigService } = require('./config/configService');
const { createOriginChecker } = require('./config/security');
const { createWsHub } = require('./websocket/wsHub');
const { createPgBus } = require('./realtime/pgBus');
const { createLlmClient } = require('./services/ai/llmClient');
const { createAiKeyService } = require('./services/ai/aiKeyService');
const { createAuthService } = require('./services/authService');
const { createStaffService } = require('./services/staffService');
const { createIntentClassifier } = require('./services/intentClassifier');
const { createRuleAssistant } = require('./services/ruleAssistant');
const { createFaqMatcher } = require('./services/faqMatcher');
const { createRetriever } = require('./services/rag/retriever');
const { createLiveKnowledge } = require('./services/rag/liveKnowledge');
const { createAnswerService } = require('./services/rag/answerService');
const { createSecurityGuard } = require('./services/securityGuard');
const { createGroqClient } = require('./services/ai/groqClient');
const { createMindtekClient } = require('./services/ai/mindtekClient');
const { createAiUsageMeter } = require('./services/ai/aiUsageMeter');
const { createIngestService } = require('./services/rag/ingestService');
const { createKbService } = require('./services/kbService');
const { createFaqService } = require('./services/faqService');
const { createHandoffService } = require('./services/handoffService');
const { createHandbookService } = require('./services/handbookService');
const { createRecommendService } = require('./services/recommendService');
const { createAnalyticsService } = require('./services/analyticsService');
const { createMaintenanceService } = require('./services/maintenanceService');
const { createMessengerService } = require('./services/messengerService');
const { createAppointmentService } = require('./services/submission/appointmentService');
const { createVisitorHasher } = require('./services/visitor');
const { createJobRunner } = require('./services/jobRunner');
const { createScheduler } = require('./services/scheduler');

function createContainer({ db = getDb(), logger = console, llmTransport, groqTransport, mindtekTransport, fetchImpl } = {}) {
  const isOriginAllowed = createOriginChecker();
  // authService cần chính sách đăng nhập từ configService, nhưng configService lại cần broadcast của wsHub
  // (wsHub cần authService) -> truyền tham chiếu lười, đọc khi có yêu cầu đăng nhập.
  let configService = null;
  const lazyConfig = { getOr: (k, d) => (configService ? configService.getOr(k, d) : d) };
  const authService = createAuthService({ db, configService: lazyConfig });
  const wsHub = createWsHub({ isOriginAllowed, resolveToken: (t) => authService.resolveToken(t).catch(() => null), logger });
  const pgBus = createPgBus({ db, logger });
  wsHub.useBus(pgBus);
  const { broadcast } = wsHub;

  configService = createConfigService({ db, broadcast });
  // Groq: sinh câu trả lời/phân tích (nhanh); Gemini: tra Google, vector, đọc ảnh/PDF. Khóa Groq chỉ ở .env / CSDL (mã hóa).
  const aiMeter = createAiUsageMeter({ db, configService, logger });
  const groq = createGroqClient({ apiKeys: groqTransport?.keys || env.GROQ_API_KEYS, configService, logger, meter: aiMeter, ...(groqTransport ? { transport: groqTransport } : {}) });
  // Mindtek: nhà cung cấp thứ 3 (bot.mindtek.ai) gọi ngầm từ máy chủ. Test không có transport giả -> không gọi mạng thật.
  const mindtek = createMindtekClient({ configService, logger, meter: aiMeter, ...(mindtekTransport ? { transport: mindtekTransport } : {}) });
  const llm = createLlmClient({ apiKeys: env.GEMINI_API_KEYS, configService, logger, groq, meter: aiMeter, mindtek: mindtekTransport || !process.env.HHT_TEST ? mindtek : null, ...(llmTransport ? { transport: llmTransport } : {}) });
  const aiKeyService = createAiKeyService({ db, llm, secret: env.SECRET_ENCRYPTION_KEY, broadcast, logger });
  const uploadDir = path.resolve(env.UPLOAD_DIR);

  // Danh sách ngành cho bộ phân loại: nạp lười, làm mới mỗi 5 phút.
  let majorsCache = { at: 0, rows: [] };
  const refreshMajors = async () => {
    const { rows } = await db.query('SELECT code, name FROM majors WHERE is_active');
    majorsCache = { at: Date.now(), rows };
  };
  const classifier = createIntentClassifier({ getMajors: () => majorsCache.rows });

  const faqMatcher = createFaqMatcher({ db, configService });
  const liveKnowledge = createLiveKnowledge({ db, configService, logger });
  const retriever = createRetriever({ db, configService, liveKnowledge });
  const ruleAssistant = createRuleAssistant({ configService });
  // Bí mật thật của máy chủ: nếu lọt vào câu trả lời (AI bị lừa, tài liệu chứa khóa…) sẽ bị xóa trước khi gửi.
  const securityGuard = createSecurityGuard({
    secrets: () => [
      env.DATABASE_URL, process.env.NEON_DATABASE_URL, process.env.POSTGRES_PASSWORD, env.SECRET_ENCRYPTION_KEY, env.VISITOR_HASH_SECRET,
      env.ADMIN_INITIAL_PASSWORD, env.MESSENGER_APP_SECRET, env.MESSENGER_PAGE_TOKEN, env.MESSENGER_VERIFY_TOKEN,
      ...(llm.secretValues ? llm.secretValues() : []),
    ],
  });
  const answerService = createAnswerService({ db, configService, llm, faqMatcher, retriever, ruleAssistant, classifier, broadcast, logger, securityGuard });
  const ingestService = createIngestService({ db, llm, broadcast, uploadDir, logger, configService });
  const kbService = createKbService({ db, configService, broadcast, uploadDir });
  const faqService = createFaqService({ db, configService, broadcast });
  const handoffService = createHandoffService({ db, configService, broadcast, classifier });
  const handbookService = createHandbookService({ db, configService });
  const recommendService = createRecommendService({ db, configService, llm, logger });
  const analyticsService = createAnalyticsService({ db, configService, llm, logger });
  const maintenanceService = createMaintenanceService({ db, configService, classifier });
  const appointmentService = createAppointmentService({ db, configService, broadcast });
  const messengerService = createMessengerService({ db, configService, answerService, env, logger, ...(fetchImpl ? { fetchImpl } : {}) });
  const staffService = createStaffService({ db, configService });
  const visitorHash = createVisitorHasher(env.VISITOR_HASH_SECRET);

  const jobRunner = createJobRunner({
    db, workerId: env.INSTANCE_ID, broadcast, logger,
    handlers: {
      INGEST_DOCUMENT: async (p) => {
        const out = await ingestService.processDocument(p.documentId);
        // KB_AUTO_PUBLISH: tài liệu vừa xử lý xong được trợ lý dùng ngay (vẫn ghi nhật ký, vẫn lưu trữ được).
        if (configService.getOr('KB_AUTO_PUBLISH', false) === true) {
          const { rows } = await db.query('SELECT uploaded_by FROM kb_documents WHERE id = ?', [p.documentId]);
          await kbService.publish(p.documentId, { actor: { id: rows[0]?.uploaded_by ?? null }, ip: null, reason: 'Tự công bố sau khi xử lý (KB_AUTO_PUBLISH)' });
          out.published = true;
        }
        return out;
      },
      REEMBED_ALL: (p) => ingestService.reembedMissing({ reset: Boolean(p.reset) }),
      CLASSIFY_MESSAGES: () => maintenanceService.classifyMessages(),
      PURGE_OLD_DATA: () => maintenanceService.purgeOldData(),
      GENERATE_SLOTS: () => appointmentService.generateSlots(),
      APPOINTMENT_NO_SHOW: () => appointmentService.markNoShows(),
    },
  });
  const scheduler = createScheduler({
    db, logger,
    tasks: {
      purgeSessions: () => authService.purgeExpiredSessions(),
      refreshMajors: () => (Date.now() - majorsCache.at > 5 * 60_000 ? refreshMajors() : null),
    },
  });

  function onBusEvent(type, payload) {
    if (type === 'CONFIG_UPDATED' && payload?.key) configService.reload(payload.key).catch((err) => logger.warn('[config] reload lỗi:', err.message));
    if (type === 'AI_KEYS_UPDATED') aiKeyService.reload().catch((err) => logger.warn('[aiKeys] reload lỗi:', err.message));
    wsHub.localBroadcast(type, payload, { remote: true });
  }

  return {
    env, db, logger, isOriginAllowed, wsHub, broadcast, pgBus, configService, llm, aiMeter, aiKeyService, authService, staffService, classifier, faqMatcher, retriever, liveKnowledge,
    answerService, ingestService, kbService, faqService, handoffService, handbookService, recommendService, analyticsService,
    maintenanceService, appointmentService, messengerService, visitorHash, jobRunner, scheduler, onBusEvent, refreshMajors,
    pgBusState: () => ({ connected: pgBus.isConnected() }),
  };
}

module.exports = { createContainer };
