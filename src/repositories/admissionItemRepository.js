'use strict';
const { updateWhitelisted } = require('../utils/sqlUpdate');

const crypto = require('node:crypto');

const UPDATABLE = new Set(['title', 'detail', 'audience', 'code', 'is_mandatory', 'copy_type', 'quantity', 'note', 'order_no', 'date_from', 'date_to', 'is_active', 'major_code']);
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

/** Mục do cán bộ thêm: item_key ngẫu nhiên (khóa seed dạng 'SCHEDULE:1' giữ cho dữ liệu nhập từ Excel). */
async function insert(c, fields) {
  const data = { item_key: `ADMIN:${crypto.randomUUID()}`, audience: 'ALL', detail: '', ...fields };
  const cols = Object.keys(data).filter((k) => ['item_key', 'kind', 'admission_year'].includes(k) || UPDATABLE.has(k));
  const { rows } = await c.query(
    `INSERT INTO admission_items (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')}) RETURNING *`,
    cols.map((k) => data[k]),
  );
  return rows[0];
}

const remove = (c, id) => c.query('DELETE FROM admission_items WHERE id = ?', [id]);

/** Mục giải thích hệ đào tạo / loại hỗ trợ học phí cho trang Ngành và trợ lý (mã: HE_9_PLUS, NHA_NUOC…). */
const listInfo = async (c, year) => (await c.query(
  `SELECT id, kind, code, title, detail, note, order_no FROM admission_items
    WHERE is_active AND admission_year = ? AND kind IN ('LEVEL_INFO', 'SUPPORT_INFO') ORDER BY kind, order_no, id`, [year],
)).rows;

/** Mục riêng của một ngành (Phòng Tuyển sinh/Khoa gắn major_code) – hiện trên trang chi tiết ngành. */
const listForMajor = async (c, year, majorCode) => (await c.query(
  `SELECT ${PUBLIC_COLUMNS} FROM admission_items
    WHERE is_active AND admission_year = ? AND major_code = ? AND kind IN ('DOC_CHECKLIST', 'SCHEDULE', 'ONLINE_GUIDE_STEP', 'CONTACT')
    ORDER BY kind, order_no, id`, [year, majorCode],
)).rows;

module.exports = { listForMajor, list, listAllForAdmin, findByIdForUpdate, update, insert, remove, listInfo };
