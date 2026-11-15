'use strict';
/**
 * Bước (e): tìm kiếm lai trên các đoạn thuộc tài liệu PUBLISHED của năm hiện hành.
 *   full-text top 20 (Postgres tsvector, không dấu)  +  vector top 20 (cosine, khi có embedding)
 *   -> gộp bằng Reciprocal Rank Fusion (k = 60) -> lấy RAG_TOP_K.
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

function createRetriever({ db, configService }) {
  let vectorCache = { version: null, rows: [] };

  async function vectorCandidates(queryEmbedding, kbVersion, year) {
    if (!queryEmbedding) return [];
    if (vectorCache.version !== kbVersion) {
      vectorCache = { version: kbVersion, rows: await kbChunkRepository.listPublishedEmbeddings(db, year) };
    }
    return vectorCache.rows
      .map((r) => ({ id: Number(r.id), cosine: dot(queryEmbedding, r.embedding) }))
      .sort((a, b) => b.cosine - a.cosine)
      .slice(0, CANDIDATES_PER_METHOD);
  }

  async function retrieve({ question, queryEmbedding = null, kbVersion }) {
    const year = configService.get('CURRENT_ADMISSION_YEAR');
    const topK = configService.get('RAG_TOP_K');
    const tokens = keywords(question);
    const [ftRows, vecRows] = await Promise.all([
      kbChunkRepository.fullTextSearch(db, { tokens, year, limit: CANDIDATES_PER_METHOD }),
      vectorCandidates(queryEmbedding, kbVersion, year),
    ]);
    const fused = reciprocalRankFusion([ftRows.map((r) => Number(r.id)), vecRows.map((r) => r.id)]).slice(0, topK);
    const byId = new Map(ftRows.map((r) => [Number(r.id), r]));
    const missing = fused.map((f) => f.id).filter((id) => !byId.has(id));
    for (const r of await kbChunkRepository.findByIds(db, missing)) byId.set(Number(r.id), r);
    const cosineById = new Map(vecRows.map((r) => [r.id, r.cosine]));

    const chunks = fused.map((f) => {
      const row = byId.get(f.id);
      const headNorm = normalizeVi(`${row.title} ${row.heading_path}`);
      return { ...row, id: f.id, rrf: f.rrf, cosine: cosineById.get(f.id) ?? null, coverage: coverage(tokens, `${row.content_norm} ${headNorm}`) };
    });
    // Có căn cứ khi vector đủ gần HOẶC từ khóa phủ đủ: embedding đôi khi chấm thấp câu tiếng Việt
    // ngắn/không dấu, còn độ phủ từ khóa bắt được trường hợp đó (và ngược lại với câu diễn đạt khác).
    const maxCosine = chunks.length ? Math.max(...chunks.map((c) => c.cosine ?? 0)) : 0;
    const maxCoverage = chunks.length ? Math.max(...chunks.map((c) => c.coverage)) : 0;
    const minCos = configService.get('RAG_MIN_SCORE');
    const minLex = configService.get('RAG_MIN_LEXICAL_SCORE');
    const byVector = vecRows.length > 0 && maxCosine >= minCos;
    const byLexical = maxCoverage >= minLex;
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
