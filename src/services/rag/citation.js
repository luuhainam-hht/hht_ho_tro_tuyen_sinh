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

module.exports = { validateCitations, splitSentences, digitsOf };
