'use strict';
/**
 * Chuẩn hóa tiếng Việt dùng chung cho FAQ, tìm kiếm, cache, phân loại.
 * Bỏ dấu để "hoc phi", "học phí", "HỌC PHÍ" là một; NFC trước tiên vì bàn phím/iOS có thể gửi NFD.
 */
// Hư từ so khớp ở dạng CÓ DẤU: bỏ dấu trước sẽ gộp "có"/"cơ", "khi"/"khí", "thì"/"thi"
// và làm mất "cơ khí", "thi tuyển". Nhóm thứ hai là dạng không dấu nhưng không gây nhầm nghĩa.
const ACCENTED_STOPWORDS = new Set((
  'à ạ ơi nhé nha nhỉ hả với và hoặc của cho là thì mà có không ko k gì những các cái này kia đó '
  + 'nào được bị em anh chị mình tôi cháu con ai sao thế vậy như rồi đã đang sẽ hỏi xin ở tại về '
  + 'trong nếu ad admin bạn trường ạ vâng dạ ok'
).split(/\s+/));
const UNACCENTED_STOPWORDS = new Set('khong nhung duoc minh toi oi nhe voi cua la gi nao vay roi dang ban truong ad admin ok'.split(' '));

function strip(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D');
}

/** chữ thường, bỏ dấu, chỉ giữ chữ/số/khoảng trắng */
function normalizeVi(text) {
  return strip(String(text ?? '').normalize('NFC').toLowerCase())
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Từ khóa (đã bỏ hư từ), dạng không dấu. Giữ số ("9", "12") vì "hệ 9+", "lớp 12" mang nghĩa. */
function keywords(text) {
  const raw = String(text ?? '').normalize('NFC').toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
  return raw
    .filter((t) => !ACCENTED_STOPWORDS.has(t))
    .map((t) => strip(t))
    .filter((t) => t && !UNACCENTED_STOPWORDS.has(t));
}

/** Đặc trưng = từ đơn + cặp từ liền nhau ("hoc_phi") để phân biệt "học phí" với "phí học"… */
function features(text) {
  const tokens = keywords(text);
  const set = new Set(tokens);
  for (let i = 0; i + 1 < tokens.length; i += 1) set.add(`${tokens[i]}_${tokens[i + 1]}`);
  return set;
}

/** Cosine trên tập nhị phân: |A∩B| / sqrt(|A|·|B|) */
function setCosine(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  return inter / Math.sqrt(a.size * b.size);
}

/** Tỉ lệ từ khóa của câu hỏi xuất hiện trong văn bản (độ phủ) – thước đo "có căn cứ" khi chưa có embedding. */
function coverage(queryTokens, docNorm) {
  if (!queryTokens.length) return 0;
  const words = new Set(docNorm.split(' '));
  return queryTokens.filter((t) => words.has(t)).length / queryTokens.length;
}

module.exports = { normalizeVi, keywords, features, setCosine, coverage, stripDiacritics: strip };
