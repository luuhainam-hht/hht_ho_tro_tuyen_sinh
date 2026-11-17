'use strict';
const { updateWhitelisted } = require('../utils/sqlUpdate');

const UPDATABLE = new Set(['name', 'faculty', 'levels', 'description', 'quota', 'quota_9plus_cs1', 'quota_9plus_cs2',
  'tuition_per_month_min', 'tuition_per_month_max', 'state_support', 'enterprise_support', 'support_needs_verify', 'duration',
  'admission_methods', 'career_paths', 'skills', 'work_styles', 'riasec_profile', 'subject_weights', 'profile_is_sample', 'internal_note', 'is_active']);

// Cột trả cho trang công khai (không có internal_note).
const PUBLIC_COLUMNS = `code, occupation_code, name, faculty, levels, levels_latest, listed_in_latest_table, description, quota,
  quota_9plus_cs1, quota_9plus_cs2, tuition_per_month_min, tuition_per_month_max, state_support, enterprise_support,
  support_needs_verify, duration, admission_methods, career_paths, skills, work_styles, source_codes, profile_is_sample`;

async function listActive(c, { year, level = null, faculty = null } = {}) {
  const { rows } = await c.query(
    `SELECT ${PUBLIC_COLUMNS} FROM majors
      WHERE is_active AND admission_year = ?
        AND (?::text IS NULL OR ? = ANY(levels))
        AND (?::text IS NULL OR faculty = ?)
      ORDER BY faculty, name`,
    [year, level, level, faculty, faculty],
  );
  return rows;
}

const findByCode = async (c, code) => (await c.query(`SELECT ${PUBLIC_COLUMNS}, riasec_profile, subject_weights FROM majors WHERE code = ?`, [code])).rows[0] || null;
const findByCodeForUpdate = async (c, code) => (await c.query('SELECT * FROM majors WHERE code = ? FOR UPDATE', [code])).rows[0] || null;
const listForScoring = async (c, year) => (await c.query(
  `SELECT code, name, faculty, levels, riasec_profile, subject_weights, work_styles, state_support, enterprise_support, duration, career_paths
     FROM majors WHERE is_active AND admission_year = ? AND cardinality(levels) > 0`, [year],
)).rows;
/** Thêm ngành mới (Phòng Tuyển sinh/Khoa). Trả null khi trùng mã. */
async function insert(c, fields) {
  const cols = Object.keys(fields).filter((k) => k === 'code' || k === 'occupation_code' || k === 'admission_year' || UPDATABLE.has(k));
  const { rows } = await c.query(
    `INSERT INTO majors (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')}) ON CONFLICT (code) DO NOTHING RETURNING *`,
    cols.map((k) => fields[k]),
  );
  return rows[0] || null;
}

const listAll = async (c) => (await c.query('SELECT * FROM majors ORDER BY faculty, name')).rows;
const update = (c, code, fields) => updateWhitelisted(c, { table: 'majors', idColumn: 'code', id: code, fields, allowed: UPDATABLE });
const faculties = async (c, year) => (await c.query(
  'SELECT faculty, COUNT(*)::int AS n FROM majors WHERE is_active AND admission_year = ? GROUP BY faculty ORDER BY faculty', [year],
)).rows;

module.exports = { listActive, findByCode, findByCodeForUpdate, listForScoring, listAll, insert, update, faculties, PUBLIC_COLUMNS };
