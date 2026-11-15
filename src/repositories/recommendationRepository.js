'use strict';
async function insert(c, r) {
  await c.query(
    `INSERT INTO recommendation_sessions (id, session_id, visitor_hash, answers, riasec_scores, results, explanation)
     VALUES (?, ?, ?, ?::jsonb, ?::jsonb, ?::jsonb, ?)`,
    [r.id, r.sessionId ?? null, r.visitorHash ?? null, JSON.stringify(r.answers), JSON.stringify(r.riasecScores), JSON.stringify(r.results), r.explanation ?? null],
  );
}
const findById = async (c, id) => (await c.query('SELECT id, riasec_scores, results, explanation, created_at FROM recommendation_sessions WHERE id = ?', [id])).rows[0] || null;

module.exports = { insert, findById };
