'use strict';
/**
 * Chia văn bản thành đoạn 400–800 token theo đề mục, chồng lấn ~15%, giữ heading_path và số trang.
 * Vì sao theo đề mục: câu hỏi tuyển sinh thường trúng đúng một mục ("Hồ sơ", "Học phí");
 * cắt ngang đề mục làm đoạn trích lẫn hai chủ đề -> LLM dễ trả lời lệch.
 */
const { normalizeVi } = require('../../utils/textNormalize');

const CHUNK_TARGET_TOKENS = 600;
const CHUNK_MAX_TOKENS = 800;
const CHUNK_MIN_TOKENS = 400;
const OVERLAP_RATIO = 0.15;

/** Ước lượng token: tiếng Việt ~1,3 token/âm tiết với tokenizer Gemini. */
const estimateTokens = (text) => Math.ceil(String(text).split(/\s+/).filter(Boolean).length * 1.3);

function chunkLines(lines, { target = CHUNK_TARGET_TOKENS, max = CHUNK_MAX_TOKENS, min = CHUNK_MIN_TOKENS } = {}) {
  const chunks = [];
  const headings = [];
  let buf = [];
  let bufTokens = 0;
  let bufHeading = '';

  const flush = (force = false) => {
    if (!buf.length) return;
    if (!force && bufTokens < min && chunks.length) {
      // đoạn cuối mục quá ngắn: gộp vào đoạn trước nếu chưa vượt trần
      const prev = chunks[chunks.length - 1];
      if (prev.tokenCount + bufTokens <= max && prev.headingPath === bufHeading) {
        prev.content += `\n${buf.map((b) => b.text).join('\n')}`;
        prev.tokenCount += bufTokens;
        prev.pageTo = buf[buf.length - 1].page ?? prev.pageTo;
        buf = []; bufTokens = 0;
        return;
      }
    }
    chunks.push({
      headingPath: bufHeading,
      content: buf.map((b) => b.text).join('\n'),
      tokenCount: bufTokens,
      pageFrom: buf.find((b) => b.page)?.page ?? null,
      pageTo: [...buf].reverse().find((b) => b.page)?.page ?? null,
    });
    // Chồng lấn: mang ~15% cuối sang đoạn sau để câu bị cắt ở biên vẫn tìm thấy được.
    const carry = [];
    let carryTokens = 0;
    for (let i = buf.length - 1; i >= 0 && carryTokens < target * OVERLAP_RATIO; i -= 1) {
      carry.unshift(buf[i]);
      carryTokens += buf[i].tokens;
    }
    buf = carry.length < buf.length ? carry : [];
    bufTokens = buf.reduce((s, b) => s + b.tokens, 0);
  };

  for (const line of lines) {
    if (line.heading) {
      flush(true);
      buf = []; bufTokens = 0;
      headings.length = line.heading - 1;
      headings[line.heading - 1] = line.text;
      bufHeading = headings.filter(Boolean).join(' › ');
      continue;
    }
    const tokens = estimateTokens(line.text);
    // Dòng siêu dài (bảng dán thành một dòng): cắt theo câu.
    const pieces = tokens > max ? line.text.split(/(?<=[.;])\s+/) : [line.text];
    for (const piece of pieces) {
      const t = estimateTokens(piece);
      if (bufTokens + t > max && bufTokens >= min) flush(true);
      buf.push({ text: piece, tokens: t, page: line.page });
      bufTokens += t;
      if (bufTokens >= target) flush(true);
    }
  }
  flush(false);
  return chunks.map((c, i) => ({ ...c, chunkIndex: i, contentNorm: normalizeVi(`${c.headingPath} ${c.content}`) }));
}

module.exports = { chunkLines, estimateTokens, CHUNK_TARGET_TOKENS, CHUNK_MAX_TOKENS };
