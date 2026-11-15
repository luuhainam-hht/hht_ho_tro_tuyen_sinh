'use strict';
/**
 * M1 – Hỏi đáp. Thứ tự (rẻ & chắc chắn trước, đắt & rủi ro sau):
 *   a) phiên hợp lệ + che dữ liệu cá nhân + chuẩn hóa      d) cache theo (câu hỏi, phiên bản kho)
 *   b) luật (chào hỏi, ngoài phạm vi…)                      e) truy xuất lai (full-text + vector, RRF)
 *   c) FAQ đã duyệt -> trả nguyên văn                        f) không đủ căn cứ -> FALLBACK, KHÔNG gọi LLM
 *   g) LLM với prompt nghiêm ngặt, JSON                      h) kiểm tra trích dẫn bằng mã
 *   i) lưu log, ghi cache, broadcast QUESTION_LOGGED
 * Không có LLM (chưa cấu hình key / hết ngân sách / lỗi): trích nguyên văn đoạn tốt nhất (EXTRACTIVE).
 * Không bao giờ hiển thị lỗi kỹ thuật cho thí sinh; tác vụ phụ lỗi không làm mất câu trả lời.
 */
const { HttpError } = require('../../utils/httpError');
const { sha256 } = require('../../utils/crypto');
const { normalizeVi } = require('../../utils/textNormalize');
const { vnToday } = require('../../utils/time');
const { maskPii, forMatching } = require('../piiFilter');
const { systemPromptFromConfig, buildUserPrompt } = require('../ai/promptBuilder');
const { describeLlmError } = require('../ai/llmClient');
const { validateCitations } = require('./citation');
const chatRepository = require('../../repositories/chatRepository');
const kbDocumentRepository = require('../../repositories/kbDocumentRepository');
const answerCacheRepository = require('../../repositories/answerCacheRepository');
const tokenUsageRepository = require('../../repositories/tokenUsageRepository');

const EXTRACTIVE_MAX_CHARS = 900;

function createAnswerService({
  db, configService, llm, faqMatcher, retriever, ruleAssistant, classifier, broadcast, logger = console,
}) {
  let sourceMap = { version: null, map: new Map() };

  /** source_code (S01…) -> tài liệu để dẫn nguồn cho câu trả lời FAQ. */
  async function sources(kbVersion) {
    if (sourceMap.version !== kbVersion) {
      const { rows } = await db.query("SELECT id, source_code, title, source_url FROM kb_documents WHERE source_code IS NOT NULL AND status <> 'FAILED'");
      sourceMap = { version: kbVersion, map: new Map(rows.map((r) => [r.source_code, r])) };
    }
    return sourceMap.map;
  }

  const fallbackText = () => `Hiện chưa có thông tin chính thức cho câu hỏi này. Bạn vui lòng gọi hotline ${configService.get('HOTLINE')} `
    + `hoặc bấm "Gửi câu hỏi cho cán bộ" để được trả lời trực tiếp.`;

  async function budgetLeft() {
    const budget = configService.get('DAILY_TOKEN_BUDGET');
    if (budget <= 0) return false;
    try {
      return (await tokenUsageRepository.totalForDay(db, vnToday())) < budget;
    } catch { return false; }
  }

  async function safeEmbedQuery(text) {
    try {
      const [v] = await llm.embed([text], 'RETRIEVAL_QUERY');
      return v;
    } catch (err) {
      logger.warn('[answer] embed câu hỏi lỗi, dùng tìm kiếm từ khóa:', err.message);
      return null;
    }
  }

  function chunkCitation(c, n) {
    return {
      n, chunkId: c.id, title: c.title, heading: c.heading_path || null, url: c.source_url || null,
      sourceCode: c.source_code || null, pages: c.page_from ? (c.page_to && c.page_to !== c.page_from ? `${c.page_from}–${c.page_to}` : String(c.page_from)) : null,
    };
  }

  async function tryLlm({ question, history, retrieval }) {
    const system = systemPromptFromConfig(configService);
    const res = await llm.generate({ system, history, prompt: buildUserPrompt({ question, chunks: retrieval.chunks }), json: true });
    try {
      await tokenUsageRepository.add(db, vnToday(), res.tokensIn, res.tokensOut);
    } catch (err) { logger.warn('[answer] không ghi được token:', err.message); }
    let parsed;
    try { parsed = JSON.parse(res.text.replace(/^```json\s*|\s*```$/g, '')); } catch { return { ok: false, tokens: res, reason: 'AI trả về sai định dạng JSON' }; }
    if (parsed.insufficient || typeof parsed.answer !== 'string') return { ok: false, tokens: res, reason: 'AI báo tài liệu không đủ thông tin' };
    const checked = validateCitations({
      answer: parsed.answer, chunks: retrieval.chunks, allowedNumbers: [configService.get('HOTLINE')],
    });
    if (!checked.sufficient) return { ok: false, tokens: res, reason: 'Câu trả lời của AI chứa số liệu không có trong tài liệu nên bị loại' };
    return {
      ok: true,
      tokens: res,
      answer: checked.answer,
      citations: checked.citedIndexes.map((n) => chunkCitation(retrieval.chunks[n - 1], n)),
      intent: typeof parsed.intent === 'string' ? parsed.intent.slice(0, 40) : null,
      topics: Array.isArray(parsed.topics) ? parsed.topics.filter((t) => typeof t === 'string').slice(0, 3) : null,
      majorCodes: Array.isArray(parsed.major_codes) ? parsed.major_codes.filter((t) => typeof t === 'string').slice(0, 3) : null,
    };
  }

  /**
   * dryRun: trang quản trị thử câu hỏi -> không đọc/ghi bộ nhớ đệm, không lấy lịch sử phiên.
   * trace: object nhận chi tiết từng bước (điểm FAQ, đoạn tài liệu, mô hình, lý do không dùng AI).
   */
  async function compose({ sessionId, question, majorContext, dryRun = false, trace = null }) {
    const t = trace || {};
    const cls = classifier.classify(question);
    const rule = ruleAssistant.tryAnswer(question);
    t.rule = Boolean(rule);
    if (rule) return { source: 'RULE', answer: rule.answer, citations: [], intent: rule.intent, topics: [], majorCodes: [] };

    const kbVersion = await kbDocumentRepository.kbVersion(db);
    const budgetOk = await budgetLeft();
    const llmOn = llm.available() && budgetOk;
    t.llm = { enabled: llm.enabled(), keys: llm.keyCount(), budgetOk, used: false };
    const queryEmbedding = llmOn ? await safeEmbedQuery(question) : null;
    t.vectorSearch = Boolean(queryEmbedding);

    // c) FAQ
    const { best, candidates } = await faqMatcher.match({ question, queryEmbedding, kbVersion });
    t.faq = { matched: Boolean(best), score: best?.score ?? null, candidates: candidates.slice(0, 3).map((c) => ({ question: c.faq.question, score: c.score })) };
    if (best) {
      const map = await sources(kbVersion);
      const citations = (best.faq.source_codes || []).map((code, i) => {
        const d = map.get(code);
        return { n: i + 1, title: d?.title || code, url: d?.source_url || null, sourceCode: code };
      });
      return {
        source: 'FAQ', answer: best.faq.answer, citations, faqId: best.faq.id, topScore: best.score,
        intent: best.faq.topic, topics: [best.faq.topic], majorCodes: cls.majorCodes,
      };
    }

    // d) cache
    const questionHash = sha256(normalizeVi(question));
    const cacheOn = !dryRun && configService.getOr('AI_CACHE_ENABLED', true);
    if (cacheOn) {
      try {
        const hit = await answerCacheRepository.get(db, questionHash, kbVersion);
        if (hit) return { source: 'CACHE', answer: hit.answer, citations: hit.citations, ...cls, ...hit.meta };
      } catch (err) { logger.warn('[answer] đọc cache lỗi:', err.message); }
    }

    // e) truy xuất
    const retrievalQuery = majorContext && !cls.majorCodes.includes(majorContext.code) ? `${question} ${majorContext.name}` : question;
    const retrieval = await retriever.retrieve({ question: retrievalQuery, queryEmbedding, kbVersion });
    const suggestions = candidates.map((c) => ({ faqId: c.faq.id, question: c.faq.question }));
    t.retrieval = {
      grounded: retrieval.grounded, topScore: retrieval.topScore,
      chunks: retrieval.chunks.map((c) => ({ title: c.title, heading: c.heading_path || null, cosine: c.cosine ?? null, coverage: c.coverage ?? null })),
    };

    // f) không đủ căn cứ
    if (!retrieval.grounded) {
      return { source: 'FALLBACK', answer: fallbackText(), citations: [], suggestions, topScore: retrieval.topScore, handoffSuggested: true, ...cls };
    }

    // g–h) LLM
    if (llmOn) {
      try {
        const history = sessionId ? await chatRepository.recentHistory(db, sessionId, configService.get('MAX_HISTORY_TURNS')) : [];
        const out = await tryLlm({ question, history, retrieval });
        Object.assign(t.llm, { used: true, model: out.tokens?.model || null, fallbackUsed: Boolean(out.tokens?.fallbackUsed), accepted: out.ok, reason: out.reason || null, tokensIn: out.tokens?.tokensIn ?? 0, tokensOut: out.tokens?.tokensOut ?? 0 });
        if (out.ok) {
          const meta = { intent: out.intent || cls.intent, topics: out.topics?.length ? out.topics : cls.topics, majorCodes: out.majorCodes?.length ? out.majorCodes : cls.majorCodes };
          if (cacheOn) {
            answerCacheRepository.put(db, {
              questionHash, kbVersion, answer: out.answer, citations: out.citations, meta, ttlHours: configService.get('CACHE_TTL_HOURS'),
            }).catch((err) => logger.warn('[answer] ghi cache lỗi:', err.message));
          }
          return {
            source: 'RAG', answerMode: 'LLM', answer: out.answer, citations: out.citations, topScore: retrieval.topScore,
            citedChunkIds: out.citations.map((c) => c.chunkId), tokensIn: out.tokens.tokensIn, tokensOut: out.tokens.tokensOut, ...meta,
          };
        }
      } catch (err) {
        logger.warn('[answer] LLM lỗi, chuyển sang trích dẫn nguyên văn:', err.message);
        Object.assign(t.llm, { used: true, accepted: false, reason: describeLlmError(err) });
      }
    }

    // Không có LLM: trích nguyên văn đoạn có độ phủ cao nhất (vẫn có dẫn nguồn).
    const bestChunk = [...retrieval.chunks].sort((a, b) => (b.cosine ?? b.coverage) - (a.cosine ?? a.coverage))[0];
    const text = bestChunk.content.length > EXTRACTIVE_MAX_CHARS ? `${bestChunk.content.slice(0, EXTRACTIVE_MAX_CHARS)}…` : bestChunk.content;
    return {
      source: 'RAG', answerMode: 'EXTRACTIVE', answer: `Theo văn bản tuyển sinh của trường:\n${text}`,
      citations: [chunkCitation(bestChunk, 1)], citedChunkIds: [bestChunk.id], topScore: retrieval.topScore, suggestions, ...cls,
    };
  }

  async function answer({ sessionId, message, majorCode = null }) {
    const startedAt = Date.now();
    const session = await chatRepository.findSession(db, sessionId);
    if (!session) throw new HttpError(404, 'Phiên trò chuyện không tồn tại, vui lòng tải lại trang');
    const { masked } = maskPii(message);
    let majorContext = null;
    if (majorCode) {
      const { rows } = await db.query('SELECT code, name FROM majors WHERE code = ?', [majorCode]);
      majorContext = rows[0] || null;
    }

    let reply;
    try {
      reply = await compose({ sessionId, question: forMatching(masked) || masked, majorContext });
    } catch (err) {
      // Lỗi bất ngờ (DB chập chờn…): vẫn trả lời lịch sự, không lộ lỗi kỹ thuật.
      logger.error('[answer] lỗi khi soạn câu trả lời:', err);
      reply = { source: 'FALLBACK', answer: fallbackText(), citations: [], handoffSuggested: true, intent: 'ERROR', topics: [], majorCodes: [] };
    }
    const latencyMs = Date.now() - startedAt;

    let messageId = null;
    try {
      messageId = await db.withTransaction(async (c) => {
        await chatRepository.insertMessage(c, {
          sessionId, role: 'USER', content: masked, intent: reply.intent, topics: reply.topics, majorCodes: reply.majorCodes,
        });
        const saved = await chatRepository.insertMessage(c, {
          sessionId, role: 'ASSISTANT', content: reply.answer, source: reply.source, answerMode: reply.answerMode ?? null,
          intent: reply.intent, topics: reply.topics, majorCodes: reply.majorCodes, citedChunkIds: reply.citedChunkIds ?? [],
          faqId: reply.faqId ?? null, topScore: reply.topScore ?? null, latencyMs, tokensIn: reply.tokensIn ?? 0, tokensOut: reply.tokensOut ?? 0,
        });
        return Number(saved.id);
      });
      broadcast('QUESTION_LOGGED', { source: reply.source, topics: reply.topics, majorCodes: reply.majorCodes, latencyMs, question: masked.slice(0, 200) });
    } catch (err) {
      logger.warn('[answer] không ghi được log hội thoại:', err.message);
    }

    return {
      messageId,
      answer: reply.answer,
      source: reply.source,
      answerMode: reply.answerMode ?? null,
      citations: reply.citations,
      suggestions: reply.suggestions ?? [],
      handoffSuggested: Boolean(reply.handoffSuggested) && configService.get('HANDOFF_ENABLED'),
      topics: reply.topics,
      majorCodes: reply.majorCodes,
      latencyMs,
    };
  }

  /** Trang Cài đặt AI: chạy đúng quy trình trả lời nhưng không ghi log, không dùng bộ nhớ đệm. */
  async function preview({ message }) {
    const startedAt = Date.now();
    const { masked } = maskPii(message);
    const trace = {};
    const reply = await compose({ sessionId: null, question: forMatching(masked) || masked, majorContext: null, dryRun: true, trace });
    return {
      answer: reply.answer, source: reply.source, answerMode: reply.answerMode ?? null, citations: reply.citations,
      topScore: reply.topScore ?? null, latencyMs: Date.now() - startedAt, trace,
    };
  }

  return { answer, compose, preview };
}

module.exports = { createAnswerService };
