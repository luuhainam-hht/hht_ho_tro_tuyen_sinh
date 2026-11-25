'use strict';
/**
 * M1 – Hỏi đáp. Thứ tự (rẻ & chắc chắn trước, đắt & rủi ro sau):
 *   a) phiên hợp lệ + che dữ liệu cá nhân + chuẩn hóa      d) cache theo (câu hỏi, phiên bản kho)
 *   b) luật (chào hỏi, ngoài phạm vi…)                      e) truy xuất lai (full-text + vector, RRF)
 *   c) FAQ đã duyệt -> trả nguyên văn                        f) không đủ căn cứ -> FALLBACK, KHÔNG gọi LLM
 *   g) LLM với prompt nghiêm ngặt, JSON                      h) kiểm tra trích dẫn bằng mã
 *   i) lưu log, ghi cache, broadcast QUESTION_LOGGED
 * Không có LLM (chưa cấu hình key / hết ngân sách / lỗi): trích nguyên văn đoạn tốt nhất (EXTRACTIVE).
 * Tra Google: câu hỏi tuyển sinh chưa đủ căn cứ -> tìm trên website chính thức (AI_OFFICIAL_SITE) trước;
 *   câu hỏi ngoài tuyển sinh -> trả lời bằng Google (AI_WEB_GENERAL_ENABLED).
 * Bảo mật (securityGuard): câu hỏi dò bí mật bị từ chối TRƯỚC mọi bước; mọi câu trả lời được lọc bí mật.
 * Không bao giờ hiển thị lỗi kỹ thuật cho thí sinh; tác vụ phụ lỗi không làm mất câu trả lời.
 */
const { HttpError } = require('../../utils/httpError');
const { sha256 } = require('../../utils/crypto');
const { normalizeVi, keywords, coverage } = require('../../utils/textNormalize');
const { vnToday } = require('../../utils/time');
const { maskPii, forMatching } = require('../piiFilter');
const { systemPromptFromConfig, buildUserPrompt, buildWebSearchPrompt, buildGeneralWebPrompt } = require('../ai/promptBuilder');
const { createSecurityGuard } = require('../securityGuard');
const { describeLlmError } = require('../ai/llmClient');
const { validateCitations, validateWebAnswer } = require('./citation');
const chatRepository = require('../../repositories/chatRepository');
const kbDocumentRepository = require('../../repositories/kbDocumentRepository');
const answerCacheRepository = require('../../repositories/answerCacheRepository');
const tokenUsageRepository = require('../../repositories/tokenUsageRepository');

const EXTRACTIVE_MAX_CHARS = 900;
const WEB_NOT_FOUND = /KHONG_TIM_THAY/i;
const MAX_WEB_SOURCES = 5;

/**
 * Câu hỏi có thuộc phạm vi tuyển sinh/nhà trường không (quyết định tra hht.edu.vn hay trả lời chung bằng Google).
 * Viết chặt hơn intentClassifier: "lịch sử Việt Nam", "ở đâu bán sách" không bị coi là câu hỏi tuyển sinh.
 */
const SCHOOL_TERMS = /(?<!thi )\btruong\b(?! hop)|\b(tuyen sinh|xet tuyen|nhap hoc|nganh|hoc nghe|nghe nghiep|nghe gi|nghe nao|khoa nao|hoc phi|ho tro hoc phi|mien giam|hoc bong|ho so|hoc ba|hht|cao dang|trung cap|so cap|he 9|lien thong|chi tieu|diem chuan|dang ky|thi sinh|phu huynh|ky tuc xa|ktx|co so [123]|giang vien|giao vien|sinh vien|hoc vien|tot nghiep|bang cap|van bang|chuong trinh dao tao|thuc tap|viec lam|dong phuc|lich hoc|hoc ky|nhap hoc|bo doi|xuat ngu|lop (9|12)|thcs|thpt|he nao|hoc he|dat hang|doanh nghiep tuyen|du hoc|ngan han|chung chi)\b|9\+/;
function isSchoolQuestion(question, cls) {
  if (cls?.majorCodes?.length) return true;
  return SCHOOL_TERMS.test(normalizeVi(question).replace(/\b9 \b/g, '9+ '));
}

/**
 * Khóa bộ nhớ đệm: câu hỏi đã chuẩn hóa + mã ngành đang xem. Cùng câu "học phí bao nhiêu?" ở trang ngành A
 * và ngành B là hai câu hỏi khác nhau (truy xuất được bổ sung tên ngành), không được dùng chung câu trả lời.
 */
const cacheKey = (question, majorContext = null) => sha256(`${normalizeVi(question)}|major:${majorContext?.code || ''}`);

/** 'hht.edu.vn, moet.gov.vn' -> ['hht.edu.vn', 'moet.gov.vn'] */
const parseDomains = (v) => String(v || '').split(',').map((s) => s.trim().toLowerCase().replace(/^www\./, '')).filter(Boolean);

/** Tên miền của nguồn: URL thật, hoặc tiêu đề khi Gemini trả URL chuyển hướng (khi đó tiêu đề là tên miền, vd "hht.edu.vn"). */
const GOOGLE_REDIRECT = /(^|\.)vertexaisearch\.cloud\.google\.com$|(^|\.)google\.com$/;
function sourceHost(s) {
  let host = '';
  try { host = new URL(String(s.url || '')).hostname.toLowerCase(); } catch { /* URL hỏng */ }
  if (host && !GOOGLE_REDIRECT.test(host)) return host.replace(/^www\./, '');
  const title = String(s.title || '').trim().toLowerCase().replace(/^www\./, '');
  return /^([a-z0-9-]+\.)+[a-z]{2,}$/.test(title) ? title : '';
}

/** Nguồn thuộc một trong các tên miền cho phép (khớp đúng tên miền hoặc tên miền con, không khớp chuỗi con). */
function isAllowedSource(s, domains) {
  const host = sourceHost(s);
  return Boolean(host) && domains.some((d) => host === d || host.endsWith(`.${d}`));
}
const isOfficial = (s, site) => isAllowedSource(s, parseDomains(site));

/**
 * Trích nguyên văn nhưng trả lời THẲNG: đoạn dạng "Hỏi: … / Đáp: …" (từ FAQ) chỉ lấy phần Đáp của cặp
 * khớp câu hỏi nhất; bỏ dòng tiêu đề lặp lại. Không thêm câu mở đầu kiểu "Theo văn bản…".
 */
function directAnswer(content, question) {
  const text = String(content || '').trim();
  const pairs = [...text.matchAll(/Hỏi:\s*([\s\S]*?)\n\s*Đáp:\s*([\s\S]*?)(?=\n\s*Hỏi:|$)/g)];
  if (pairs.length) {
    const q = keywords(question);
    const best = pairs
      .map((m) => ({ ans: m[2].trim(), score: coverage(q, normalizeVi(`${m[1]} ${m[2]}`)) }))
      .sort((a, b) => b.score - a.score)[0];
    if (best?.ans) return best.ans;
  }
  return text.replace(/^Hỏi:.*\n/gm, '').replace(/^Đáp:\s*/gm, '').trim();
}

function createAnswerService({
  db, configService, llm, faqMatcher, retriever, ruleAssistant, classifier, broadcast, logger = console,
  securityGuard = createSecurityGuard(),
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
      n, chunkId: c.id > 0 ? c.id : null, title: c.title, heading: c.heading_path || null, url: c.source_url || null,
      sourceCode: c.source_code || null, pages: c.page_from ? (c.page_to && c.page_to !== c.page_from ? `${c.page_from}–${c.page_to}` : String(c.page_from)) : null,
    };
  }

  /**
   * Tra cứu Internet (Google Search grounding) khi kho tri thức không đủ căn cứ. Chỉ chấp nhận khi Gemini
   * trả về ít nhất một nguồn web thật (groundingMetadata) – không có nguồn thì coi như không tìm thấy.
   */
  async function tryWeb({ question, contextChunks = [], general = false }) {
    const get = (k, d) => configService.getOr(k, d);
    const site = get('AI_OFFICIAL_SITE', 'hht.edu.vn');
    const base = {
      schoolName: get('SCHOOL_NAME', 'Nhà trường'), hotline: get('HOTLINE', ''), maxWords: get('AI_ANSWER_MAX_WORDS', 150),
      tone: get('AI_TONE', 'THAN_THIEN'), question, site,
    };
    const domains = parseDomains(get('AI_WEB_ALLOWED_DOMAINS', site));
    const { system, prompt } = general ? buildGeneralWebPrompt(base) : buildWebSearchPrompt({ ...base, contextChunks, domains });
    const res = await llm.generate({ system, prompt, search: true });
    try { await tokenUsageRepository.add(db, vnToday(), res.tokensIn, res.tokensOut); } catch (err) { logger.warn('[answer] không ghi được token:', err.message); }
    const text = String(res.text || '').replace(/^```\w*\s*|\s*```$/g, '').trim();
    const all = res.webSources || [];
    if (!text || WEB_NOT_FOUND.test(text) || text.length < 20) return { ok: false, tokens: res, reason: 'Không tìm thấy thông tin đáng tin cậy trên Internet' };
    if (!all.length) return { ok: false, tokens: res, reason: 'Tra cứu Internet không trả về nguồn nào nên không dùng' };

    // Câu hỏi tuyển sinh: CHỈ nhận nguồn thuộc tên miền cho phép (mặc định hht.edu.vn). Trang tổng hợp như
    // Tuyensinh247 từng trộn thông tin HHT với trường khác (docs/DU-LIEU.md V16) nên không được làm căn cứ.
    // Câu hỏi chung (khi Admin bật): nhận mọi nguồn nhưng vẫn kiểm tra con số.
    const trusted = general ? () => true : (s) => isAllowedSource(s, domains);
    const sources = all.filter(trusted).slice(0, MAX_WEB_SOURCES);
    if (!sources.length) {
      return { ok: false, tokens: res, reason: `Nguồn tìm được không thuộc ${domains.join(', ')} nên không dùng`, rejectedSources: all.length };
    }

    // Con số (học phí, ngày, chỉ tiêu) chỉ giữ khi Google xác nhận đoạn chứa nó có nguồn tin cậy.
    const checked = validateWebAnswer({
      answer: text, supports: res.webSupports || [], isTrusted: trusted, allowedNumbers: [get('HOTLINE', '')], contextChunks,
    });
    if (!checked.sufficient) {
      return { ok: false, tokens: res, reason: 'Câu trả lời Internet chứa số liệu không có nguồn tin cậy nên bị loại', droppedSentences: checked.dropped.length };
    }
    // Nguồn trên website chính thức lên đầu và được đánh dấu.
    const ordered = [...sources.filter((x) => isOfficial(x, site)), ...sources.filter((x) => !isOfficial(x, site))];
    return {
      ok: true, tokens: res, answer: checked.answer, official: ordered.some((x) => isOfficial(x, site)), droppedSentences: checked.dropped.length,
      rejectedSources: all.length - all.filter(trusted).length,
      citations: ordered.map((x, i) => ({ n: i + 1, chunkId: null, title: x.title, url: x.url, web: true, official: isOfficial(x, site) })),
    };
  }

  // Tra Google cần Gemini (Groq không có công cụ tìm kiếm).
  const geminiOn = () => (llm.geminiAvailable ? llm.geminiAvailable() : llm.available());
  const webSearchOn = (llmOn) => llmOn && geminiOn() && configService.getOr('AI_WEB_SEARCH_ENABLED', true) !== false;
  const generalWebOn = (llmOn) => webSearchOn(llmOn) && configService.getOr('AI_WEB_GENERAL_ENABLED', false) === true;

  async function webOrNull({ question, contextChunks, t, cls, retrieval, general = false }) {
    try {
      const out = await tryWeb({ question, contextChunks, general });
      t.web = {
        used: true, mode: general ? 'GENERAL' : 'SCHOOL', accepted: out.ok, official: Boolean(out.official), reason: out.reason || null,
        sources: out.citations?.length || 0, rejectedSources: out.rejectedSources || 0, droppedSentences: out.droppedSentences || 0,
      };
      if (!out.ok) return null;
      return {
        source: 'WEB', answerMode: 'LLM', answer: out.answer, citations: out.citations, topScore: retrieval?.topScore ?? null,
        webMode: general ? 'GENERAL' : 'SCHOOL', webOfficial: Boolean(out.official),
        tokensIn: out.tokens.tokensIn, tokensOut: out.tokens.tokensOut, ...cls, ...(general ? { intent: 'GENERAL', topics: ['KHAC'] } : {}),
      };
    } catch (err) {
      logger.warn('[answer] tra cứu Internet lỗi:', err.message);
      t.web = { used: true, accepted: false, reason: describeLlmError(err) };
      return null;
    }
  }

  async function tryLlm({ question, history, retrieval }) {
    const system = systemPromptFromConfig(configService);
    const res = await llm.generate({ system, history, prompt: buildUserPrompt({ question, chunks: retrieval.chunks }), json: true, task: 'CHAT' });
    try {
      await tokenUsageRepository.add(db, vnToday(), res.tokensIn, res.tokensOut);
    } catch (err) { logger.warn('[answer] không ghi được token:', err.message); }
    let parsed;
    try { parsed = JSON.parse(res.text.replace(/^```json\s*|\s*```$/g, '')); } catch { return { ok: false, tokens: res, reason: 'AI trả về sai định dạng JSON' }; }
    if (parsed.insufficient || typeof parsed.answer !== 'string') return { ok: false, insufficient: true, tokens: res, reason: 'AI báo tài liệu không đủ thông tin' };
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
    // Bảo mật: câu hỏi dò bí mật/prompt injection -> từ chối ngay, không gửi cho AI, không tra Internet.
    if (securityGuard.detectSecretProbe(question)) {
      t.security = { blocked: true };
      return { source: 'RULE', answer: securityGuard.REFUSAL, citations: [], intent: 'SECURITY', topics: ['KHAC'], majorCodes: [] };
    }
    const cls = classifier.classify(question);
    const rule = ruleAssistant.tryAnswer(question);
    t.rule = Boolean(rule);
    const budgetOk = await budgetLeft();
    const llmOn = llm.available() && budgetOk;
    t.llm = { enabled: llm.enabled(), keys: llm.keyCount(), budgetOk, used: false };
    if (rule) {
      // Câu hỏi ngoài tuyển sinh: bật "trả lời bằng Google" thì AI tra cứu và trả lời kèm nguồn thay vì từ chối.
      if (rule.intent === 'OUT_OF_SCOPE' && generalWebOn(llmOn)) {
        const web = await webOrNull({ question, contextChunks: [], t, cls, retrieval: null, general: true });
        if (web) return web;
      }
      return { source: 'RULE', answer: rule.answer, citations: [], intent: rule.intent, topics: [], majorCodes: [] };
    }

    const kbVersion = await kbDocumentRepository.kbVersion(db);
    const queryEmbedding = llmOn && geminiOn() ? await safeEmbedQuery(question) : null;
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

    // d) cache. Câu trả lời của LLM phụ thuộc cả ngành đang xem (majorContext) lẫn lịch sử hội thoại, nên:
    //    - khóa cache gồm câu hỏi + mã ngành đang xem (cacheKey);
    //    - phiên đã có lịch sử thì KHÔNG đọc/ghi cache (câu nối tiếp "còn ngành đó thì sao?" không dùng chung giữa các phiên).
    let history = [];
    if (sessionId && !dryRun) {
      try {
        history = await chatRepository.recentHistory(db, sessionId, configService.get('MAX_HISTORY_TURNS'));
      } catch (err) { logger.warn('[answer] không đọc được lịch sử hội thoại:', err.message); }
    }
    const questionHash = cacheKey(question, majorContext);
    const cacheOn = !dryRun && history.length === 0 && configService.getOr('AI_CACHE_ENABLED', true);
    t.cache = { enabled: Boolean(cacheOn), reason: dryRun ? 'DRY_RUN' : history.length ? 'HAS_HISTORY' : null };
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

    // f) không đủ căn cứ -> tra cứu Internet (nếu bật và có AI) -> không được thì FALLBACK
    if (!retrieval.grounded) {
      if (webSearchOn(llmOn)) {
        // Câu hỏi tuyển sinh: tra website chính thức trước; câu hỏi chung: trả lời bằng Google (nếu bật).
        const school = isSchoolQuestion(question, cls);
        t.scope = school ? 'SCHOOL' : 'GENERAL';
        const web = school || generalWebOn(llmOn)
          ? await webOrNull({ question, contextChunks: [], t, cls, retrieval, general: !school })
          : null;
        if (web) return web;
      }
      return { source: 'FALLBACK', answer: fallbackText(), citations: [], suggestions, topScore: retrieval.topScore, handoffSuggested: true, ...cls };
    }

    // g–h) LLM
    if (llmOn) {
      try {
        const out = await tryLlm({ question, history, retrieval });
        Object.assign(t.llm, { used: true, model: out.tokens?.model || null, provider: out.tokens?.provider || null, fallbackUsed: Boolean(out.tokens?.fallbackUsed), accepted: out.ok, reason: out.reason || null, tokensIn: out.tokens?.tokensIn ?? 0, tokensOut: out.tokens?.tokensOut ?? 0 });
        if (out.ok) {
          const meta = { intent: out.intent || cls.intent, topics: out.topics?.length ? out.topics : cls.topics, majorCodes: out.majorCodes?.length ? out.majorCodes : cls.majorCodes };
          if (cacheOn) {
            answerCacheRepository.put(db, {
              questionHash, kbVersion, answer: out.answer, citations: out.citations, meta, ttlHours: configService.get('CACHE_TTL_HOURS'),
            }).catch((err) => logger.warn('[answer] ghi cache lỗi:', err.message));
          }
          return {
            source: 'RAG', answerMode: 'LLM', answer: out.answer, citations: out.citations, topScore: retrieval.topScore,
            citedChunkIds: out.citations.map((c) => c.chunkId).filter(Boolean), tokensIn: out.tokens.tokensIn, tokensOut: out.tokens.tokensOut, ...meta,
          };
        }
        // AI đọc tài liệu và báo không đủ thông tin -> thử tra Internet trước khi trích nguyên văn.
        if (out.insufficient && webSearchOn(llmOn)) {
          const school = isSchoolQuestion(question, cls);
          t.scope = school ? 'SCHOOL' : 'GENERAL';
          if (school || generalWebOn(llmOn)) {
            const web = await webOrNull({ question, contextChunks: school ? retrieval.chunks : [], t, cls, retrieval, general: !school });
            if (web) return web;
          }
        }
      } catch (err) {
        logger.warn('[answer] LLM lỗi, chuyển sang trích dẫn nguyên văn:', err.message);
        Object.assign(t.llm, { used: true, accepted: false, reason: describeLlmError(err) });
      }
    }

    // Không có LLM: trích nguyên văn đoạn có độ phủ cao nhất (vẫn có dẫn nguồn).
    // Đoạn sát ý nhất: ưu tiên giống nghĩa (vector), rồi độ phủ "từ quan trọng" (IDF), rồi đoạn ngắn – cụ thể hơn.
    const score = (c) => c.cosine ?? ((c.weightedCoverage ?? c.coverage) + (c.headCoverage || 0));
    const bestChunk = [...retrieval.chunks].sort((a, b) => score(b) - score(a) || a.content.length - b.content.length)[0];
    const direct = directAnswer(bestChunk.content, question) || bestChunk.content;
    const text = direct.length > EXTRACTIVE_MAX_CHARS ? `${direct.slice(0, EXTRACTIVE_MAX_CHARS)}…` : direct;
    return {
      source: 'RAG', answerMode: 'EXTRACTIVE', answer: text,
      citations: [chunkCitation(bestChunk, 1)], citedChunkIds: bestChunk.id > 0 ? [bestChunk.id] : [], topScore: retrieval.topScore, suggestions, ...cls,
    };
  }

  /** Lọc bí mật trên MỌI câu trả lời (kể cả FAQ, trích văn bản, Internet) trước khi lưu log và gửi đi. */
  function secure(reply) {
    const out = securityGuard.sanitizeAnswer(reply.answer);
    if (out.redacted) logger.warn(`[security] đã ${out.blocked ? 'chặn' : 'ẩn bí mật trong'} câu trả lời (nguồn ${reply.source})`);
    if (out.blocked) return { ...reply, answer: out.text, citations: [], intent: 'SECURITY', redacted: true };
    return out.redacted ? { ...reply, answer: out.text, redacted: true } : reply;
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
      reply = secure(reply);
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
      webMode: reply.webMode ?? null,
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
    const reply = secure(await compose({ sessionId: null, question: forMatching(masked) || masked, majorContext: null, dryRun: true, trace }));
    trace.security = { ...(trace.security || {}), redacted: Boolean(reply.redacted) };
    return {
      answer: reply.answer, source: reply.source, answerMode: reply.answerMode ?? null, citations: reply.citations,
      topScore: reply.topScore ?? null, latencyMs: Date.now() - startedAt, trace,
    };
  }

  return { answer, compose, preview };
}

module.exports = { createAnswerService, directAnswer, cacheKey, isAllowedSource, parseDomains };
