'use strict';
async function get(c, questionHash, kbVersion) {
  const { rows } = await c.query(
    `UPDATE answer_cache SET hit_count = hit_count + 1
      WHERE question_hash = ? AND kb_version = ? AND expires_at > now() RETURNING answer, citations, meta`,
    [questionHash, kbVersion],
  );
  return rows[0] || null;
}

async function put(c, { questionHash, kbVersion, answer, citations, meta, ttlHours }) {
  await c.query(
    `INSERT INTO answer_cache (question_hash, kb_version, answer, citations, meta, expires_at)
     VALUES (?, ?, ?, ?::jsonb, ?::jsonb, now() + make_interval(hours => ?))
     ON CONFLICT (question_hash, kb_version) DO UPDATE
       SET answer = EXCLUDED.answer, citations = EXCLUDED.citations, meta = EXCLUDED.meta, expires_at = EXCLUDED.expires_at`,
    [questionHash, kbVersion, answer, JSON.stringify(citations), JSON.stringify(meta), ttlHours],
  );
}

const purgeExpired = async (c) => (await c.query('DELETE FROM answer_cache WHERE expires_at <= now()')).rowCount;

module.exports = { get, put, purgeExpired };
