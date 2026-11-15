'use strict';
/**
 * Đọc & kiểm tra input ở tầng route. Route chỉ gọi các hàm này rồi chuyển sang service,
 * nên mọi lỗi định dạng đều trả 400 với thông điệp tiếng Việt thống nhất.
 */
const { HttpError } = require('./httpError');

const VN_PHONE_PATTERN = /^(0|\+84)(3|5|7|8|9)\d{8}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function str(source, field, { label = field, required = false, max = 500, min = 0, pattern, patternMessage } = {}) {
  const raw = source?.[field];
  if (raw === undefined || raw === null || raw === '') {
    if (required) throw new HttpError(400, `Thiếu thông tin: ${label}`);
    return null;
  }
  if (typeof raw !== 'string') throw new HttpError(400, `${label} phải là chuỗi ký tự`);
  const value = raw.trim();
  if (required && !value) throw new HttpError(400, `Thiếu thông tin: ${label}`);
  if (value.length < min) throw new HttpError(400, `${label} phải có ít nhất ${min} ký tự`);
  if (value.length > max) throw new HttpError(400, `${label} không được dài quá ${max} ký tự`);
  if (pattern && value && !pattern.test(value)) throw new HttpError(400, patternMessage || `${label} không hợp lệ`);
  return value || null;
}

function int(source, field, { label = field, required = false, min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = source?.[field];
  if (raw === undefined || raw === null || raw === '') {
    if (required) throw new HttpError(400, `Thiếu thông tin: ${label}`);
    return null;
  }
  const value = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isInteger(value)) throw new HttpError(400, `${label} phải là số nguyên`);
  if (value < min || value > max) throw new HttpError(400, `${label} phải trong khoảng ${min}–${max}`);
  return value;
}

function oneOf(source, field, allowed, { label = field, required = false, fallback = null } = {}) {
  const value = str(source, field, { label, required, max: 50 });
  if (value === null) return fallback;
  if (!allowed.includes(value)) throw new HttpError(400, `${label} không hợp lệ`);
  return value;
}

function phone(source, field = 'phone', opts = {}) {
  const value = str(source, field, { label: 'Số điện thoại', max: 15, ...opts });
  if (value === null) return null;
  const normalized = value.replace(/[\s.-]/g, '');
  if (!VN_PHONE_PATTERN.test(normalized)) throw new HttpError(400, 'Số điện thoại không hợp lệ');
  // Chuẩn hóa về dạng 0xxxxxxxxx để đếm "yêu cầu đang mở theo SĐT" chính xác.
  return normalized.replace(/^\+84/, '0');
}

function email(source, field = 'email', opts = {}) {
  return str(source, field, { label: 'Email', max: 254, pattern: EMAIL_PATTERN, patternMessage: 'Email không hợp lệ', ...opts });
}

function idParam(params, field = 'id') {
  return int(params, field, { label: 'Mã định danh', required: true, min: 1 });
}

function bool(source, field, { fallback = null } = {}) {
  const raw = source?.[field];
  if (raw === undefined || raw === null || raw === '') return fallback;
  if (raw === true || raw === 'true' || raw === 1 || raw === '1') return true;
  if (raw === false || raw === 'false' || raw === 0 || raw === '0') return false;
  throw new HttpError(400, `${field} phải là true/false`);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function uuid(source, field, { label = field, required = false } = {}) {
  return str(source, field, { label, required, max: 36, pattern: UUID, patternMessage: `${label} không hợp lệ` });
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
function date(source, field, { label = field, required = false } = {}) {
  const v = str(source, field, { label, required, max: 10, pattern: ISO_DATE, patternMessage: `${label} phải có dạng YYYY-MM-DD` });
  if (v && Number.isNaN(Date.parse(`${v}T00:00:00Z`))) throw new HttpError(400, `${label} không phải ngày hợp lệ`);
  return v;
}

function strArray(source, field, { label = field, maxItems = 50, maxLength = 200, pattern = null } = {}) {
  const raw = source?.[field];
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > maxItems) throw new HttpError(400, `${label} phải là danh sách tối đa ${maxItems} mục`);
  return raw.map((x) => {
    if (typeof x !== 'string' || x.length > maxLength || (pattern && !pattern.test(x))) throw new HttpError(400, `${label} có mục không hợp lệ`);
    return x.trim();
  }).filter(Boolean);
}

function number(source, field, { label = field, required = false, min = -Infinity, max = Infinity } = {}) {
  const raw = source?.[field];
  if (raw === undefined || raw === null || raw === '') {
    if (required) throw new HttpError(400, `Thiếu thông tin: ${label}`);
    return null;
  }
  const v = Number(raw);
  if (!Number.isFinite(v) || v < min || v > max) throw new HttpError(400, `${label} không hợp lệ`);
  return v;
}

module.exports = { str, int, oneOf, phone, email, idParam, bool, uuid, date, strArray, number };
