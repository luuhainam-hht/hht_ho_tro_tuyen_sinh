'use strict';
async function enqueue(c, { type, payload = {}, dedupeKey = null, runAfterSeconds = 0, maxAttempts = 3 }) {
  const { rows } = await c.query(
    `INSERT INTO jobs (type, payload, dedupe_key, run_after, max_attempts)
     VALUES (?, ?::jsonb, ?, now() + make_interval(secs => ?), ?)
     ON CONFLICT (dedupe_key) DO NOTHING RETURNING *`,
    [type, JSON.stringify(payload), dedupeKey, runAfterSeconds, maxAttempts],
  );
  return rows[0] || null; // null = đã có việc cùng dedupe_key (chạy đúng 1 lần/ngày)
}

/** Lấy 1 việc sẵn sàng: SKIP LOCKED để nhiều bản chạy không giành cùng một việc. */
async function claimNext(c, workerId) {
  const { rows } = await c.query(
    `UPDATE jobs SET status = 'RUNNING', attempts = attempts + 1, locked_by = ?, locked_at = now()
      WHERE id = (SELECT id FROM jobs WHERE status = 'QUEUED' AND run_after <= now()
                   ORDER BY run_after, id FOR UPDATE SKIP LOCKED LIMIT 1)
      RETURNING *`,
    [workerId],
  );
  return rows[0] || null;
}

const complete = (c, id, result) => c.query("UPDATE jobs SET status = 'DONE', result = ?::jsonb, locked_by = NULL WHERE id = ?", [JSON.stringify(result ?? {}), id]);

/** Lỗi: còn lượt thì xếp lại với backoff, hết lượt thì FAILED. */
async function fail(c, job, error, backoffSeconds) {
  const final = job.attempts >= job.max_attempts;
  await c.query(
    `UPDATE jobs SET status = ?, last_error = ?, locked_by = NULL, run_after = now() + make_interval(secs => ?) WHERE id = ?`,
    [final ? 'FAILED' : 'QUEUED', String(error).slice(0, 2000), backoffSeconds, job.id],
  );
  return final;
}

/** Việc RUNNING bị bỏ dở (bản chạy chết giữa chừng) -> trả về hàng đợi. */
const requeueStale = async (c, staleSeconds) => (await c.query(
  `UPDATE jobs SET status = 'QUEUED', locked_by = NULL WHERE status = 'RUNNING' AND locked_at < now() - make_interval(secs => ?)`, [staleSeconds],
)).rowCount;

const listRecent = async (c, limit = 50) => (await c.query('SELECT id, type, status, attempts, last_error, created_at, updated_at FROM jobs ORDER BY id DESC LIMIT ?', [limit])).rows;

module.exports = { enqueue, claimNext, complete, fail, requeueStale, listRecent };
