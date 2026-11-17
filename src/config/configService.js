'use strict';
/**
 * Dynamic Policy Engine: tham số nghiệp vụ trong system_configs, cache RAM, ép kiểu, kiểm tra biên,
 * bộ kiểm tra riêng theo khóa. Sửa qua Admin có hiệu lực ngay trên mọi bản chạy (CONFIG_UPDATED).
 */
const { HttpError } = require('../utils/httpError');
const { parseTime } = require('../utils/time');
const { CONFIG_META, CONFIG_DEFAULTS } = require('./configDefaults');
// Thứ tự hiển thị = thứ tự khai báo trong configDefaults (đã xếp theo mức quan trọng), không theo bảng chữ cái.
const ORDER = new Map(CONFIG_DEFAULTS.map((d, i) => [d.key, i]));

const STRING_MAX_LENGTH = 2000;
// Tham số chuỗi được phép để trống (tùy chọn).
const EMPTY_ALLOWED = new Set(['AI_EXTRA_INSTRUCTIONS', 'LLM_FALLBACK_MODEL']);

function normalizeByType(row, raw) {
  const input = String(raw ?? '').trim();
  const fail = (msg) => { throw new HttpError(400, `${row.key}: ${msg}`); };
  const min = row.min_bound === null || row.min_bound === undefined ? null : Number(row.min_bound);
  const max = row.max_bound === null || row.max_bound === undefined ? null : Number(row.max_bound);
  const bounds = (n) => {
    if (min !== null && n < min) fail(`không được nhỏ hơn ${min}`);
    if (max !== null && n > max) fail(`không được lớn hơn ${max}`);
  };
  switch (row.value_type) {
    case 'INT': {
      if (!/^-?\d+$/.test(input)) fail('phải là số nguyên');
      bounds(Number(input));
      return String(Number(input));
    }
    case 'NUMBER': {
      const n = Number(input.replace(',', '.'));
      if (input === '' || !Number.isFinite(n)) fail('phải là số');
      bounds(n);
      return String(n);
    }
    case 'BOOL': {
      const v = input.toLowerCase();
      if (['true', '1', 'on', 'bật'].includes(v)) return 'true';
      if (['false', '0', 'off', 'tắt'].includes(v)) return 'false';
      return fail('phải là true/false');
    }
    case 'TIME': {
      const m = /^(\d{1,2}):(\d{2})$/.exec(input);
      if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) fail('phải có dạng HH:MM');
      return `${m[1].padStart(2, '0')}:${m[2]}`;
    }
    case 'LIST': {
      const items = input.split(',').map((s) => s.trim()).filter(Boolean);
      if (!items.length) fail('không được để trống');
      const nums = items.map((s) => { if (!/^\d+$/.test(s)) fail('chỉ gồm số, phân tách bằng dấu phẩy'); bounds(Number(s)); return Number(s); });
      return [...new Set(nums)].sort((a, b) => a - b).join(',');
    }
    case 'JSON': {
      try { return JSON.stringify(JSON.parse(input)); } catch { return fail('không phải JSON hợp lệ'); }
    }
    case 'STRING': {
      if (!input && !EMPTY_ALLOWED.has(row.key)) fail('không được để trống');
      if (input.length > STRING_MAX_LENGTH) fail(`không dài quá ${STRING_MAX_LENGTH} ký tự`);
      return input;
    }
    default:
      return fail('kiểu dữ liệu không hỗ trợ');
  }
}

function parseValue(type, value) {
  switch (type) {
    case 'INT':
    case 'NUMBER': return Number(value);
    case 'BOOL': return value === 'true';
    case 'LIST': return value.split(',').map(Number);
    case 'JSON': return JSON.parse(value);
    default: return value;
  }
}

/** Khung giờ 'HH:MM-HH:MM,HH:MM-HH:MM' -> [{start, end}] (phút trong ngày), tăng dần, không chồng nhau. */
function parseTimeSlots(value) {
  const ranges = String(value).split(',').map((s) => s.trim()).filter(Boolean).map((part) => {
    const m = /^(\d{2}:\d{2})-(\d{2}:\d{2})$/.exec(part);
    if (!m) throw new HttpError(400, `OFFICE_TIME_SLOTS: "${part}" phải có dạng HH:MM-HH:MM`);
    const start = parseTime(m[1]);
    const end = parseTime(m[2]);
    if (start >= end) throw new HttpError(400, `OFFICE_TIME_SLOTS: "${part}" giờ bắt đầu phải trước giờ kết thúc`);
    return { start, end };
  });
  if (!ranges.length) throw new HttpError(400, 'OFFICE_TIME_SLOTS không được để trống');
  for (let i = 1; i < ranges.length; i += 1) {
    if (ranges[i].start < ranges[i - 1].end) throw new HttpError(400, 'OFFICE_TIME_SLOTS: các khung giờ bị chồng nhau hoặc không theo thứ tự');
  }
  return ranges;
}

const AI_TONES = ['THAN_THIEN', 'TRANG_TRONG', 'NGAN_GON'];
const assertModelName = (v) => { if (!/^[a-z0-9.\-_/]{3,80}$/i.test(v)) throw new HttpError(400, 'Tên mô hình không hợp lệ'); };
const ORIGIN_PATTERN = /^https?:\/\/[a-z0-9.-]+(:\d+)?$/i;

/** Kiểm tra riêng theo khóa, chạy SAU khi đã chuẩn hóa kiểu. */
const KEY_VALIDATORS = {
  OFFICE_TIME_SLOTS: (v) => { parseTimeSlots(v); },
  ALLOWED_EMBED_ORIGINS: (v) => {
    const arr = JSON.parse(v);
    if (!Array.isArray(arr) || !arr.every((o) => typeof o === 'string' && ORIGIN_PATTERN.test(o))) {
      throw new HttpError(400, 'ALLOWED_EMBED_ORIGINS phải là mảng origin dạng ["https://ten-mien"]');
    }
  },
  RECOMMEND_WEIGHTS: (v) => {
    const w = JSON.parse(v);
    const keys = ['riasec', 'subject', 'preference'];
    if (!keys.every((k) => typeof w[k] === 'number' && w[k] >= 0)) throw new HttpError(400, 'RECOMMEND_WEIGHTS cần 3 số riasec, subject, preference');
    if (Math.abs(keys.reduce((s, k) => s + w[k], 0) - 1) > 0.001) throw new HttpError(400, 'Tổng trọng số RECOMMEND_WEIGHTS phải bằng 1');
  },
  LLM_MODEL: (v) => assertModelName(v),
  LLM_FALLBACK_MODEL: (v) => { if (v) assertModelName(v); },
  EMBEDDING_MODEL: (v) => assertModelName(v),
  AI_TONE: (v) => { if (!AI_TONES.includes(v)) throw new HttpError(400, `AI_TONE chỉ nhận: ${AI_TONES.join(', ')}`); },
  FACULTY_PAGES: (v) => {
    const o = JSON.parse(v);
    if (!o || typeof o !== 'object' || Array.isArray(o)) throw new HttpError(400, 'FACULTY_PAGES phải có dạng {"Tên khoa": "https://…"}');
    for (const [k, url] of Object.entries(o)) {
      if (!k.trim() || typeof url !== 'string' || !/^https:\/\/[^\s"'<>]+$/i.test(url)) throw new HttpError(400, `FACULTY_PAGES: đường dẫn của khoa "${k}" phải bắt đầu bằng https://`);
    }
  },
  AI_OFFICIAL_SITE: (v) => { if (!/^([a-z0-9-]+\.)+[a-z]{2,}$/i.test(v)) throw new HttpError(400, 'AI_OFFICIAL_SITE chỉ ghi tên miền, vd: hht.edu.vn'); },
  AI_ASSISTANT_NAME: (v) => { if (!v || v.length > 60) throw new HttpError(400, 'Tên trợ lý từ 1 đến 60 ký tự'); },
};

function createConfigService({ db, broadcast = () => {}, onChange = () => {} }) {
  const cache = new Map();

  const put = (row) => cache.set(row.key, { row, parsed: parseValue(row.value_type, row.value) });

  async function loadAll() {
    const { rows } = await db.query('SELECT * FROM system_configs');
    cache.clear();
    rows.forEach(put);
    return cache.size;
  }

  async function reload(key) {
    const { rows } = await db.query('SELECT * FROM system_configs WHERE key = ?', [key]);
    if (rows[0]) put(rows[0]);
  }

  function get(key) {
    const e = cache.get(key);
    if (!e) throw new Error(`Thiếu tham số cấu hình: ${key}`); // lỗi seed/lập trình -> 500
    return e.parsed;
  }

  const getPublic = () => Object.fromEntries([...cache.values()].filter((e) => e.row.is_public).map((e) => [e.row.key, e.parsed]));

  const list = () => [...cache.values()].map(({ row }) => ({
    key: row.key, value: row.value, valueType: row.value_type, isPublic: row.is_public,
    minBound: row.min_bound === null ? null : Number(row.min_bound),
    maxBound: row.max_bound === null ? null : Number(row.max_bound),
    description: row.description, updatedAt: row.updated_at,
    group: CONFIG_META[row.key]?.group || 'GENERAL', label: CONFIG_META[row.key]?.label || row.key,
  })).sort((a, b) => (ORDER.get(a.key) ?? 999) - (ORDER.get(b.key) ?? 999) || a.key.localeCompare(b.key));

  async function update(key, rawValue, { actorId, ip, reason = null }) {
    const updated = await db.withTransaction(async (client) => {
      const { rows } = await client.query('SELECT * FROM system_configs WHERE key = ? FOR UPDATE', [key]);
      if (!rows[0]) throw new HttpError(404, 'Không tìm thấy tham số cấu hình');
      const value = normalizeByType(rows[0], rawValue);
      KEY_VALIDATORS[key]?.(value);
      const res = await client.query('UPDATE system_configs SET value = ?, updated_by = ? WHERE key = ? RETURNING *', [value, actorId, key]);
      await client.query(
        `INSERT INTO audit_logs (actor_id, action, target_type, target_id, reason, payload, ip)
         VALUES (?, 'CONFIG_UPDATE', 'CONFIG', ?, ?, ?::jsonb, ?)`,
        [actorId, key, reason, JSON.stringify({ from: rows[0].value, to: value }), ip],
      );
      return res.rows[0];
    });
    put(updated);
    broadcast('CONFIG_UPDATED', { key });
    try { onChange(key); } catch { /* tác vụ phụ */ }
    return updated;
  }

  /** Đọc tham số, chưa có (CSDL cũ chưa chạy migration) thì dùng giá trị dự phòng thay vì lỗi 500. */
  function getOr(key, fallback) {
    const e = cache.get(key);
    return e ? e.parsed : fallback;
  }

  return { loadAll, reload, get, getOr, getPublic, list, update };
}

module.exports = { createConfigService, normalizeByType, parseTimeSlots, KEY_VALIDATORS, AI_TONES };
