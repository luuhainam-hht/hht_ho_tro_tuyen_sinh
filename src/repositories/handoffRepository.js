'use strict';
const { updateWhitelisted } = require('../utils/sqlUpdate');

const UPDATABLE = new Set(['status', 'assigned_to', 'answer', 'answered_at', 'promote_to_faq', 'faq_id']);

async function insert(c, h) {
  const { rows } = await c.query(
    `INSERT INTO handoff_requests (session_id, question, contact_name, contact_phone, contact_email, consent)
     VALUES (?, ?, ?, ?, ?, ?) RETURNING *`,
    [h.sessionId ?? null, h.question, h.contactName ?? null, h.contactPhone ?? null, h.contactEmail ?? null, h.consent],
  );
  return rows[0];
}

const findByIdForUpdate = async (c, id) => (await c.query('SELECT * FROM handoff_requests WHERE id = ? FOR UPDATE', [id])).rows[0] || null;
const update = (c, id, fields) => updateWhitelisted(c, { table: 'handoff_requests', id, fields, allowed: UPDATABLE });

async function list(c, { status = null, limit = 200 } = {}) {
  const { rows } = await c.query(
    `SELECT h.*, s.full_name AS assigned_to_name FROM handoff_requests h LEFT JOIN staff s ON s.id = h.assigned_to
      WHERE (?::text IS NULL OR h.status = ?) ORDER BY (h.status IN ('NEW','ASSIGNED')) DESC, h.created_at DESC LIMIT ?`,
    [status, status, limit],
  );
  return rows;
}

const contextMessages = async (c, sessionId) => (sessionId ? (await c.query(
  'SELECT role, content, source, created_at FROM chat_messages WHERE session_id = ? ORDER BY id DESC LIMIT 12', [sessionId],
)).rows.reverse() : []);

module.exports = { insert, findByIdForUpdate, update, list, contextMessages };
