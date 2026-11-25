'use strict';
/**
 * Bước (e): tìm kiếm lai trên các đoạn thuộc tài liệu PUBLISHED (mọi năm học khi RAG_ALL_YEARS bật)
 *   + tri thức "sống" dựng từ dữ liệu ngành/đợt nhận hồ sơ/liên hệ đang hiệu lực (liveKnowledge).
 *   full-text top 20 (Postgres tsvector, không dấu)  +  vector top 20 (cosine, khi có embedding)
 *   + dữ liệu sống top 20 (độ phủ từ khóa) -> gộp bằng Reciprocal Rank Fusion (k = 60) -> lấy RAG_TOP_K.
 * grounded (có đủ căn cứ hay không): cosine cao nhất ≥ RAG_MIN_SCORE (khi có vector)
 *   hoặc độ phủ từ khóa cao nhất ≥ RAG_MIN_LEXICAL_SCORE.
 */
const { keywords, coverage, normalizeVi } = require('../../utils/textNormalize');
const { dot } = require('../ai/llmClient');
const kbChunkRepository = require('../../repositories/kbChunkRepository');

const RRF_K = 60;
const CANDIDATES_PER_METHOD = 20;

/** RRF thuần (unit test được): lists = [[id…], [id…]] theo thứ hạng. */
function reciprocalRankFusion(lists, k = RRF_K) {
  const score = new Map();
  for (const list of lists) {
    list.forEach((id, idx) => score.set(id, (score.get(id) || 0) + 1 / (k + idx + 1)));
  }
  return [...score.entries()].sort((a, b) => b[1] - a[1]).map(([id, s]) => ({ id, rrf: s }));
}

/** Độ phủ có trọng số IDF cũng phải đạt ngưỡng RAG_MIN_LEXICAL_SCORE (hệ số 1). */
const WEIGHTED_GROUNDING_RATIO = 1;

function createRetriever({ db, configService, liveKnowledge = null }) {
  let vectorCache = { version: null, rows: [] };
  let dfCache = { version: null, df: new Map(), total: 0 };

  /**
   * Tần suất từ trên toàn kho (đoạn văn bản + dữ liệu sống). Dùng để chặn "có căn cứ giả": câu hỏi chỉ
   * trùng từ phổ biến ("trường", "cơ sở", "học") nhưng trượt ý chính ("bể bơi").
   */
  async function corpusStats(kbVersion, year) {
    const ver = `${kbVersion}|${year}`;
    if (dfCache.version === ver) return dfCache;
    const df = new Map();
    let total = 0;
    const addDoc = (text) => {
      total += 1;
      for (const w of new Set(text.split(' '))) if (w) df.set(w, (df.get(w) || 0) + 1);
    };
    for (const r of await kbChunkRepository.listPublishedNorms(db, year)) addDoc(`${r.content_norm} ${normalizeVi(`${r.title} ${r.heading_path}`)}`);
    if (liveKnowledge) for (const c of await liveKnowledge.all(kbVersion)) addDoc(`${c.content_norm} ${c.head_norm}`);
    dfCache = { version: ver, df, total };
    return dfCache;
  }

  function idfCoverage(tokens, text, { df, total }) {
    if (!tokens.length) return 0;
    const words = new Set(text.split(' '));
    let all = 0;
    let hit = 0;
    for (const t of tokens) {
      const w = Math.log((total + 1) / ((df.get(t) || 0) + 1)) + 1;
      all += w;
      if (words.has(t)) hit += w;
    }
    return hit / all;
  }

  async function vectorCandidates(queryEmbedding, kbVersion, year) {
    if (!queryEmbedding) return [];
    const ver = `${kbVersion}|${year}`;
    if (vectorCache.version !== ver) {
      vectorCache = { version: ver, rows: await kbChunkRepository.listPublishedEmbeddings(db, year) };
    }
    return vectorCache.rows
      .map((r) => ({ id: Number(r.id), cosine: dot(queryEmbedding, r.embedding) }))
      .sort((a, b) => b.cosine - a.cosine)
      .slice(0, CANDIDATES_PER_METHOD);
  }

  async function retrieve({ question, queryEmbedding = null, kbVersion }) {
    // RAG_ALL_YEARS (mặc định bật): học toàn bộ tài liệu đã công bố của mọi năm học (year = 0).
    const year = configService.getOr('RAG_ALL_YEARS', false) === true ? 0 : configService.get('CURRENT_ADMISSION_YEAR');
    const topK = configService.get('RAG_TOP_K');
    const tokens = keywords(question);
    const [ftRows, vecRows, liveRows] = await Promise.all([
      kbChunkRepository.fullTextSearch(db, { tokens, year, limit: CANDIDATES_PER_METHOD }),
      vectorCandidates(queryEmbedding, kbVersion, year),
      liveKnowledge ? liveKnowledge.search({ tokens, kbVersion, limit: CANDIDATES_PER_METHOD }) : [],
    ]);
    const fused = reciprocalRankFusion([ftRows.map((r) => Number(r.id)), vecRows.map((r) => r.id), liveRows.map((r) => r.id)]).slice(0, topK);
    const byId = new Map([...ftRows.map((r) => [Number(r.id), r]), ...liveRows.map((r) => [r.id, r])]);
    const missing = fused.map((f) => f.id).filter((id) => !byId.has(id) && id > 0);
    for (const r of await kbChunkRepository.findByIds(db, missing)) byId.set(Number(r.id), r);
    const cosineById = new Map(vecRows.map((r) => [r.id, r.cosine]));
    const stats = await corpusStats(kbVersion, year);

    const chunks = fused.map((f) => {
      const row = byId.get(f.id);
      const headNorm = row.head_norm || normalizeVi(`${row.title} ${row.heading_path}`);
      const text = `${row.content_norm} ${headNorm}`;
      return {
        ...row, words: undefined, id: f.id, rrf: f.rrf, cosine: cosineById.get(f.id) ?? null,
        coverage: coverage(tokens, text), weightedCoverage: idfCoverage(tokens, text, stats),
        // độ phủ trên riêng tiêu đề đoạn (không gồm tên tài liệu) – để chọn đoạn đúng chủ đề khi trích nguyên văn
        headCoverage: idfCoverage(tokens, normalizeVi(row.heading_path || ''), stats),
      };
    });
    // Có căn cứ khi vector đủ gần HOẶC từ khóa phủ đủ: embedding đôi khi chấm thấp câu tiếng Việt
    // ngắn/không dấu, còn độ phủ từ khóa bắt được trường hợp đó (và ngược lại với câu diễn đạt khác).
    const maxCosine = chunks.length ? Math.max(...chunks.map((c) => c.cosine ?? 0)) : 0;
    const minCos = configService.get('RAG_MIN_SCORE');
    const minLex = configService.get('RAG_MIN_LEXICAL_SCORE');
    // Có căn cứ theo từ khóa: một đoạn vừa phủ đủ từ khóa, vừa phủ đủ "từ quan trọng" (trọng số IDF).
    const lexicalOk = chunks.filter((c) => c.coverage >= minLex && c.weightedCoverage >= minLex * WEIGHTED_GROUNDING_RATIO);
    const maxCoverage = lexicalOk.length ? Math.max(...lexicalOk.map((c) => c.coverage)) : (chunks.length ? Math.max(...chunks.map((c) => c.weightedCoverage)) : 0);
    const byVector = vecRows.length > 0 && maxCosine >= minCos;
    const byLexical = lexicalOk.length > 0;
    return {
      chunks,
      topScore: byVector ? maxCosine : maxCoverage,
      scoreType: byVector ? 'COSINE' : 'COVERAGE',
      grounded: byVector || byLexical,
    };
  }

  return { retrieve };
}

module.exports = { createRetriever, reciprocalRankFusion };
