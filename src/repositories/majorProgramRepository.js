'use strict';
/**
 * Thông tin tuyển sinh theo hệ của từng ngành (bảng major_programs).
 * Mọi hàm nhận (client, …) để dùng chung transaction với majors.
 */

/** Thứ tự cột hiển thị: Hệ 9+, SC, TC, CĐ (theo yêu cầu của Nhà trường). */
const LEVEL_ORDER = ['HE_9_PLUS', 'SO_CAP', 'TRUNG_CAP', 'CAO_DANG'];
const LEVEL_SHORT = { HE_9_PLUS: 'Hệ 9+', SO_CAP: 'Sơ cấp', TRUNG_CAP: 'Trung cấp', CAO_DANG: 'Cao đẳng' };
const COLUMNS = 'major_code, level, quota_cs1, quota_cs2, quota_cs3, duration, tuition_min, tuition_max, tuition_note, methods, note, updated_at';
const FIELDS = ['quota_cs1', 'quota_cs2', 'quota_cs3', 'duration', 'tuition_min', 'tuition_max', 'tuition_note', 'methods', 'note'];

const byLevel = (a, b) => LEVEL_ORDER.indexOf(a.level) - LEVEL_ORDER.indexOf(b.level);

async function listByMajor(c, code) {
  const { rows } = await c.query(`SELECT ${COLUMNS} FROM major_programs WHERE major_code = ?`, [code]);
  return rows.sort(byLevel);
}

/** Map major_code -> [program] cho danh sách ngành (trang quản trị, trợ lý). */
async function mapByMajors(c, codes = null) {
  const { rows } = codes
    ? await c.query(`SELECT ${COLUMNS} FROM major_programs WHERE major_code = ANY(?::text[])`, [codes])
    : await c.query(`SELECT ${COLUMNS} FROM major_programs`);
  const out = new Map();
  for (const r of rows.sort(byLevel)) {
    if (!out.has(r.major_code)) out.set(r.major_code, []);
    out.get(r.major_code).push(r);
  }
  return out;
}

/**
 * Ghi lại toàn bộ bảng của một ngành: hệ không còn trong danh sách bị xóa, hệ có thì thêm/cập nhật.
 * programs: [{ level, quota_cs1, …, note }] đã kiểm tra hợp lệ.
 */
async function replaceForMajor(c, code, programs) {
  const levels = programs.map((p) => p.level);
  await c.query('DELETE FROM major_programs WHERE major_code = ? AND NOT (level = ANY(?::text[]))', [code, levels]);
  for (const p of programs) {
    await c.query(
      `INSERT INTO major_programs (major_code, level, ${FIELDS.join(', ')})
       VALUES (?, ?, ${FIELDS.map(() => '?').join(', ')})
       ON CONFLICT (major_code, level) DO UPDATE SET ${FIELDS.map((f) => `${f} = EXCLUDED.${f}`).join(', ')}`,
      [code, p.level, ...FIELDS.map((f) => (p[f] === undefined ? null : p[f]))],
    );
  }
  return listByMajor(c, code);
}

/**
 * Đồng bộ phần tóm tắt trên majors từ bảng theo hệ, để bộ lọc trang Ngành học, gợi ý ngành và
 * trợ lý (đọc majors) luôn khớp với bảng Phòng Tuyển sinh/Khoa vừa sửa.
 */
async function syncMajorSummary(c, code) {
  const programs = await listByMajor(c, code);
  const p9 = programs.find((p) => p.level === 'HE_9_PLUS');
  const duration = programs.filter((p) => p.duration).map((p) => `${LEVEL_SHORT[p.level]}: ${p.duration}`).join('; ') || null;
  // Học phí chung của ngành = khoảng học phí của hệ Trung cấp/Cao đẳng (hỗ trợ học phí % tính trên mức này).
  const paid = programs.filter((p) => (p.level === 'TRUNG_CAP' || p.level === 'CAO_DANG') && (p.tuition_min || p.tuition_max));
  const lo = paid.length ? Math.min(...paid.map((p) => p.tuition_min ?? p.tuition_max)) : null;
  const hi = paid.length ? Math.max(...paid.map((p) => p.tuition_max ?? p.tuition_min)) : null;
  await c.query(
    `UPDATE majors SET levels = ?::text[], quota_9plus_cs1 = ?, quota_9plus_cs2 = ?, duration = ?,
            tuition_per_month_min = ?, tuition_per_month_max = ?
      WHERE code = ?`,
    [programs.map((p) => p.level), p9?.quota_cs1 ?? null, p9?.quota_cs2 ?? null, duration, lo, hi, code],
  );
  return programs;
}

/**
 * Tạo bảng theo hệ cho các ngành chưa có (ngành cũ trước bản này, ngành mới từ db/seed).
 * Chỉ thêm dòng còn thiếu – không ghi đè số liệu cán bộ đã sửa. Thời gian học, phương thức lấy theo
 * cẩm nang tuyển sinh 2026–2027 (FAQ Q2, Q10); chỉ tiêu 9+ từ bảng ngành 08/2026.
 */
async function backfillMissing(c) {
  await c.query(`
    INSERT INTO major_programs (major_code, level, quota_cs1, quota_cs2, duration, tuition_min, tuition_max, tuition_note, methods)
    SELECT m.code, l.level,
           CASE WHEN l.level = 'HE_9_PLUS' THEN m.quota_9plus_cs1 END,
           CASE WHEN l.level = 'HE_9_PLUS' THEN m.quota_9plus_cs2 END,
           CASE l.level WHEN 'CAO_DANG' THEN 'Khoảng 3 năm'
                        WHEN 'TRUNG_CAP' THEN 'Khoảng 2 năm'
                        WHEN 'HE_9_PLUS' THEN '4 năm (3 năm THPT + Trung cấp, 1 năm Cao đẳng)' END,
           CASE WHEN l.level IN ('TRUNG_CAP', 'CAO_DANG') THEN m.tuition_per_month_min END,
           CASE WHEN l.level IN ('TRUNG_CAP', 'CAO_DANG') THEN m.tuition_per_month_max END,
           CASE WHEN l.level = 'HE_9_PLUS' THEN 'Miễn 100% học phí giai đoạn Trung cấp' END,
           CASE l.level WHEN 'CAO_DANG' THEN 'Xét học bạ THPT hoặc điểm thi tốt nghiệp THPT (xét tất cả tổ hợp)'
                        WHEN 'TRUNG_CAP' THEN 'Xét học bạ THCS/THPT'
                        WHEN 'HE_9_PLUS' THEN 'Xét học bạ THCS (tốt nghiệp THCS)' END
      FROM majors m CROSS JOIN LATERAL unnest(m.levels) AS l(level)
     WHERE NOT EXISTS (SELECT 1 FROM major_programs p WHERE p.major_code = m.code AND p.level = l.level)
    ON CONFLICT (major_code, level) DO NOTHING`);
}

module.exports = { LEVEL_ORDER, LEVEL_SHORT, FIELDS, listByMajor, mapByMajors, replaceForMajor, syncMajorSummary, backfillMissing };
