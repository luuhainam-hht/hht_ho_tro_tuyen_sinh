'use strict';
async function insert(c, { actorId, action, targetType, targetId = null, reason = null, payload = {}, ip = null }) {
  await c.query(
    `INSERT INTO audit_logs (actor_id, action, target_type, target_id, reason, payload, ip)
     VALUES (?, ?, ?, ?, ?, ?::jsonb, ?)`,
    [actorId, action, targetType, targetId === null ? null : String(targetId), reason, JSON.stringify(payload), ip],
  );
}

async function list(c, { limit = 100, targetType = null } = {}) {
  const { rows } = await c.query(
    `SELECT a.*, s.full_name AS actor_name FROM audit_logs a LEFT JOIN staff s ON s.id = a.actor_id
      WHERE (?::text IS NULL OR a.target_type = ?) ORDER BY a.id DESC LIMIT ?`,
    [targetType, targetType, limit],
  );
  return rows;
}

module.exports = { insert, list };
