'use strict';
/**
 * Bước (h): kiểm tra câu trả lời của LLM bằng mã, không tin LLM tự giác:
 *  - [n] phải trỏ tới đoạn có thật trong ngữ cảnh; [n] sai bị gỡ.
 *  - Câu có con số/ngày/phần trăm mà KHÔNG có [n] hợp lệ, hoặc con số không xuất hiện trong đoạn
 *    được trích -> bỏ câu đó (chống bịa học phí, chỉ tiêu, ngày tháng).
 *  - Còn lại quá ít hoặc không còn trích dẫn nào -> coi như không đủ căn cứ (FALLBACK).
 */
const MIN_ANSWER_CHARS = 30;
const CITE = /\[(\d{1,2})\]/g;
const HAS_NUMBER = /\d/;

const digitsOf = (s) => (String(s).match(/\d[\d.,]*/g) || []).map((n) => n.replace(/[.,]/g, '')).filter((n) => n.length > 0);

function splitSentences(text) {
  return String(text).split(/(?<=[.!?…])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
}

function validateCitations({ answer, chunks, allowedNumbers = [] }) {
  const allowed = new Set(allowedNumbers.flatMap(digitsOf));
  const chunkDigits = chunks.map((c) => new Set(digitsOf(c.content)));
  const kept = [];
  const dropped = [];
  const cited = new Set();

  for (const sentence of splitSentences(answer)) {
    const refs = [...sentence.matchAll(CITE)].map((m) => Number(m[1]));
    const valid = refs.filter((n) => n >= 1 && n <= chunks.length);
    let clean = sentence.replace(CITE, (m, n) => (Number(n) >= 1 && Number(n) <= chunks.length ? m : '')).replace(/\s{2,}/g, ' ').trim();
    const withoutCites = clean.replace(CITE, '');
    if (HAS_NUMBER.test(withoutCites)) {
      const nums = digitsOf(withoutCites).filter((n) => !allowed.has(n));
      const supported = nums.every((n) => valid.some((i) => chunkDigits[i - 1].has(n)));
      if (nums.length && (!valid.length || !supported)) {
        dropped.push(sentence);
        continue;
      }
    }
    valid.forEach((n) => cited.add(n));
    if (clean) kept.push(clean);
    clean = '';
  }
  const text = kept.join('\n').trim();
  const sufficient = text.replace(CITE, '').trim().length >= MIN_ANSWER_CHARS && cited.size > 0;
  return { answer: text, citedIndexes: [...cited].sort((a, b) => a - b), dropped, sufficient };
}

/**
 * Kiểm tra câu trả lời tra cứu Internet (không có đoạn văn bản gốc để đối chiếu như RAG):
 *  - Câu có con số chỉ được giữ khi các con số đó nằm trong một đoạn mà Google xác nhận có nguồn
 *    (groundingSupports) VÀ nguồn đó được tin cậy (isTrusted, vd thuộc hht.edu.vn).
 *  - Con số trong allowedNumbers (hotline) và trong đoạn tài liệu nội bộ (contextChunks) luôn được phép.
 *  - Câu không có con số giữ nguyên. Còn lại quá ít -> sufficient = false.
 */
const squash = (s) => String(s || '').replace(/\s+/g, ' ').trim();

function validateWebAnswer({ answer, supports = [], isTrusted = () => true, allowedNumbers = [], contextChunks = [] }) {
  const allowed = new Set([...allowedNumbers.flatMap(digitsOf), ...contextChunks.flatMap((c) => digitsOf(c.content))]);
  const trusted = supports.filter((s) => s.sources.some(isTrusted)).map((s) => ({ text: squash(s.text), digits: new Set(digitsOf(s.text)) }));
  const kept = [];
  const dropped = [];
  for (const sentence of splitSentences(answer)) {
    const nums = digitsOf(sentence).filter((n) => !allowed.has(n));
    if (!nums.length) { kept.push(sentence); continue; }
    const s = squash(sentence);
    // Đoạn có nguồn chồng lên câu này (Google chia đoạn khác cách tách câu của ta: chứa nhau theo một trong hai chiều).
    const overlapping = trusted.filter((x) => x.text && (x.text.includes(s) || s.includes(x.text)));
    const supported = nums.every((n) => overlapping.some((x) => x.digits.has(n)));
    if (supported) kept.push(sentence);
    else dropped.push(sentence);
  }
  const text = kept.join('\n').trim();
  return { answer: text, dropped, sufficient: text.length >= MIN_ANSWER_CHARS };
}

module.exports = { validateCitations, validateWebAnswer, splitSentences, digitsOf };
