'use strict';
async function createSession(c, { id, channel, visitorHash, externalRef = null }) {
  const { rows } = await c.query(
    `INSERT INTO chat_sessions (id, channel, visitor_hash, external_ref) VALUES (?, ?, ?, ?)
     ON CONFLICT (channel, external_ref) WHERE external_ref IS NOT NULL DO UPDATE SET last_at = now()
     RETURNING *`,
    [id, channel, visitorHash, externalRef],
  );
  return rows[0];
}

const findSession = async (c, id) => (await c.query('SELECT * FROM chat_sessions WHERE id = ?', [id])).rows[0] || null;

async function insertMessage(c, m) {
  const { rows } = await c.query(
    `INSERT INTO chat_messages (session_id, role, content, source, answer_mode, intent, topics, major_codes, cited_chunk_ids,
                                faq_id, top_score, latency_ms, tokens_in, tokens_out)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id, created_at`,
    [m.sessionId, m.role, m.content, m.source ?? null, m.answerMode ?? null, m.intent ?? null, m.topics ?? [], m.majorCodes ?? [],
      m.citedChunkIds ?? [], m.faqId ?? null, m.topScore ?? null, m.latencyMs ?? null, m.tokensIn ?? 0, m.tokensOut ?? 0],
  );
  await c.query('UPDATE chat_sessions SET last_at = now(), message_count = message_count + 1 WHERE id = ?', [m.sessionId]);
  return rows[0];
}

/** Lịch sử gần nhất (cũ -> mới) để LLM hiểu câu hỏi nối tiếp ("ngành đó học mấy năm?"). */
async function recentHistory(c, sessionId, turns) {
  if (!turns) return [];
  const { rows } = await c.query(
    'SELECT role, content FROM chat_messages WHERE session_id = ? ORDER BY id DESC LIMIT ?', [sessionId, turns * 2],
  );
  return rows.reverse();
}

async function rate(c, { messageId, sessionId, rating }) {
  const { rows } = await c.query(
    "UPDATE chat_messages SET rating = ? WHERE id = ? AND session_id = ? AND role = 'ASSISTANT' RETURNING id",
    [rating, messageId, sessionId],
  );
  return rows[0] || null;
}

const listUnclassified = async (c, limit = 200) => (await c.query(
  "SELECT id, content FROM chat_messages WHERE role = 'USER' AND intent IS NULL ORDER BY id LIMIT ?", [limit],
)).rows;
const setClassification = (c, id, { intent, topics, majorCodes }) =>
  c.query('UPDATE chat_messages SET intent = ?, topics = ?, major_codes = ? WHERE id = ?', [intent, topics, majorCodes, id]);

/** Ẩn danh nội dung cũ: giữ số liệu thống kê, xóa chữ. */
async function anonymizeOlderThan(c, days) {
  const res = await c.query(
    "UPDATE chat_messages SET content = '[đã xóa theo chính sách lưu trữ]' WHERE created_at < now() - make_interval(days => ?) AND content <> '[đã xóa theo chính sách lưu trữ]'",
    [days],
  );
  return res.rowCount;
}

module.exports = { createSession, findSession, insertMessage, recentHistory, rate, listUnclassified, setClassification, anonymizeOlderThan };
