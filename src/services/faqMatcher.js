'use strict';
/**
 * Bước (c): khớp câu hỏi với FAQ đã duyệt -> trả NGUYÊN VĂN đáp án (không gọi LLM).
 *  - Có embedding (câu hỏi + FAQ): cosine ≥ FAQ_MATCH_SCORE.
 *  - Chưa có (chưa cấu hình key, hoặc LLM lỗi): độ giống từ khóa ≥ FAQ_LEXICAL_MATCH_SCORE,
 *    so với câu hỏi chính và từng "cách hỏi khác" (lấy điểm cao nhất).
 * Danh sách FAQ cache theo kb_version: duyệt/sửa FAQ là cache tự làm mới.
 */
const { features, setCosine, keywords } = require('../utils/textNormalize');
const { dot } = require('./ai/llmClient');
const faqRepository = require('../repositories/faqRepository');

function createFaqMatcher({ db, configService }) {
  let cache = { version: null, entries: [] };

  async function load(kbVersion) {
    if (cache.version === kbVersion) return cache.entries;
    const rows = await faqRepository.listApproved(db, configService.get('CURRENT_ADMISSION_YEAR'));
    const entries = rows.map((r) => ({
      ...r,
      featureSets: [r.question, ...(r.variants || [])].map(features).filter((s) => s.size),
    }));
    cache = { version: kbVersion, entries };
    return entries;
  }

  /** @returns {{faq, score, method}|null} kèm candidates (top 3) để gợi ý khi FALLBACK */
  async function match({ question, queryEmbedding = null, kbVersion }) {
    const entries = await load(kbVersion);
    const qFeat = features(question);
    // Câu quá ngắn ("học phí?") vẫn khớp được, nhưng 1 từ khóa đơn lẻ dễ trùng nhầm -> phạt nhẹ.
    const shortPenalty = keywords(question).length <= 1 ? 0.85 : 1;
    const scored = entries.map((e) => {
      const lexical = Math.max(0, ...e.featureSets.map((f) => setCosine(qFeat, f))) * shortPenalty;
      const semantic = queryEmbedding && e.embedding ? dot(queryEmbedding, e.embedding) : null;
      return { faq: e, lexical, semantic };
    });
    const lexMin = configService.get('FAQ_LEXICAL_MATCH_SCORE');
    const semMin = configService.get('FAQ_MATCH_SCORE');
    let best = null;
    for (const s of scored) {
      const ok = (s.semantic !== null && s.semantic >= semMin) || s.lexical >= lexMin;
      if (!ok) continue;
      const score = s.semantic !== null ? Math.max(s.semantic, s.lexical) : s.lexical;
      if (!best || score > best.score) best = { faq: s.faq, score, method: s.semantic !== null && s.semantic >= semMin ? 'SEMANTIC' : 'LEXICAL' };
    }
    const candidates = scored
      .map((s) => ({ faq: s.faq, score: s.semantic ?? s.lexical }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .filter((c) => c.score > 0.25);
    return { best, candidates };
  }

  return { match, invalidate: () => { cache = { version: null, entries: [] }; } };
}

module.exports = { createFaqMatcher };
