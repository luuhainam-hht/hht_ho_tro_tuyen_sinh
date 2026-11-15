'use strict';
const { updateWhitelisted } = require('../utils/sqlUpdate');

const UPDATABLE = new Set(['title', 'detail', 'is_mandatory', 'copy_type', 'quantity', 'note', 'order_no', 'date_from', 'date_to', 'is_active']);
const PUBLIC_COLUMNS = 'id, kind, audience, major_code, code, title, detail, is_mandatory, copy_type, quantity, note, order_no, date_from, date_to, source_codes';

async function list(c, { year, kind, audience = null, majorCode = null }) {
  const { rows } = await c.query(
    `SELECT ${PUBLIC_COLUMNS} FROM admission_items
      WHERE is_active AND admission_year = ? AND kind = ?
        AND (?::text IS NULL OR audience = ?)
        AND (major_code IS NULL OR major_code = ?)
      ORDER BY order_no, id`,
    [year, kind, audience, audience, majorCode],
  );
  return rows;
}

const listAllForAdmin = async (c, year) => (await c.query(
  'SELECT * FROM admission_items WHERE admission_year = ? ORDER BY kind, audience, order_no, id', [year],
)).rows;
const findByIdForUpdate = async (c, id) => (await c.query('SELECT * FROM admission_items WHERE id = ? FOR UPDATE', [id])).rows[0] || null;
const update = (c, id, fields) => updateWhitelisted(c, { table: 'admission_items', id, fields, allowed: UPDATABLE });

module.exports = { list, listAllForAdmin, findByIdForUpdate, update };
