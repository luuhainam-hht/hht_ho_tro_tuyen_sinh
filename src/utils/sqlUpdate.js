'use strict';
/**
 * UPDATE có whitelist cột. Vì sao: ghép tên cột từ key của object là lỗ hổng SQL injection
 * tiềm ẩn nếu sau này ai đó truyền thẳng req.body (rủi ro đã nêu trong bản thiết kế).
 */
const NOW = Symbol('NOW');

async function updateWhitelisted(client, { table, idColumn = 'id', id, fields, allowed, extraWhere = '', extraParams = [] }) {
  const sets = [];
  const params = [];
  for (const [col, val] of Object.entries(fields)) {
    if (val === undefined) continue;
    if (!allowed.has(col)) throw new Error(`Cột không được phép cập nhật: ${table}.${col}`);
    if (val === NOW) sets.push(`${col} = now()`);
    else { sets.push(`${col} = ?`); params.push(val !== null && typeof val === 'object' && !Array.isArray(val) ? JSON.stringify(val) : val); }
  }
  if (!sets.length) throw new Error('Không có cột nào để cập nhật');
  const { rows } = await client.query(
    `UPDATE ${table} SET ${sets.join(', ')} WHERE ${idColumn} = ? ${extraWhere} RETURNING *`,
    [...params, id, ...extraParams],
  );
  return rows[0] || null;
}

module.exports = { NOW, updateWhitelisted };
