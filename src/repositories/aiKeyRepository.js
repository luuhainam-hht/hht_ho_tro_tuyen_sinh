'use strict';
const { updateWhitelisted } = require('../utils/sqlUpdate');

// Không bao giờ SELECT key_cipher ra API: chỉ aiKeyService.loadActive() cần nó.
const PUBLIC_COLUMNS = 'id, label, provider, key_hint, is_active, last_test_at, last_test_ok, last_test_message, created_by, created_at, updated_at';
const UPDATABLE = new Set(['label', 'is_active', 'last_test_at', 'last_test_ok', 'last_test_message']);

const list = async (c) => (await c.query(`SELECT ${PUBLIC_COLUMNS} FROM ai_api_keys ORDER BY id`)).rows;
const findSecret = async (c, id) => (await c.query('SELECT id, label, key_cipher FROM ai_api_keys WHERE id = ?', [id])).rows[0] || null;
const listActiveSecrets = async (c) => (await c.query('SELECT id, label, key_cipher FROM ai_api_keys WHERE is_active ORDER BY id')).rows;

async function insert(c, { label, provider = 'GEMINI', keyCipher, keyHash, keyHint, createdBy }) {
  const { rows } = await c.query(
    `INSERT INTO ai_api_keys (label, provider, key_cipher, key_hash, key_hint, created_by) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (key_hash) DO NOTHING RETURNING ${PUBLIC_COLUMNS}`,
    [label, provider, keyCipher, keyHash, keyHint, createdBy],
  );
  return rows[0] || null;
}

const update = (c, id, fields) => updateWhitelisted(c, { table: 'ai_api_keys', id, fields, allowed: UPDATABLE });
const remove = async (c, id) => (await c.query(`DELETE FROM ai_api_keys WHERE id = ? RETURNING ${PUBLIC_COLUMNS}`, [id])).rows[0] || null;

module.exports = { list, findSecret, listActiveSecrets, insert, update, remove };
