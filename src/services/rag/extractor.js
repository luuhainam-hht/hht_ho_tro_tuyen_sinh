'use strict';
/**
 * Trích văn bản từ PDF/DOCX/TXT thành các dòng có đánh dấu đề mục ('# ', '## ') và số trang.
 * DOCX: mammoth -> HTML để giữ đề mục (extractRawText làm mất cấu trúc).
 * PDF: pdf-parse, gom chữ theo từng trang để trích dẫn được "trang x".
 */
const fs = require('node:fs/promises');
const mammoth = require('mammoth');
// Import thẳng lib: index.js của pdf-parse@1 tự đọc file test khi chạy không có module.parent.
const pdfParse = require('pdf-parse/lib/pdf-parse.js');

const MIME = {
  PDF: 'application/pdf',
  DOCX: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  TXT: 'text/plain',
  MD: 'text/markdown',
};
const SUPPORTED_MIME = new Set(Object.values(MIME));

const decodeEntities = (s) => s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'");

function htmlToLines(html) {
  const lines = [];
  const re = /<(h[1-6]|p|li|td|th)[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = re.exec(html))) {
    const text = decodeEntities(m[2].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const tag = m[1].toLowerCase();
    if (tag.startsWith('h')) lines.push({ heading: Number(tag[1]), text, page: null });
    else lines.push({ text: tag === 'li' ? `- ${text}` : text, page: null });
  }
  return lines;
}

/** Dòng văn bản thuần: nhận đề mục kiểu "I. ...", "1. ...", "Điều 3." hoặc markdown "#". */
function textToLines(text, page = null) {
  return String(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
    const md = /^(#{1,6})\s+(.*)$/.exec(l);
    if (md) return { heading: md[1].length, text: md[2], page };
    if (/^(PHẦN|CHƯƠNG|MỤC)\s+[IVXLC\d]+/i.test(l) || /^[IVX]{1,4}\.\s+\S/.test(l)) return { heading: 1, text: l, page };
    if (/^Điều\s+\d+/i.test(l) || (/^\d{1,2}\.\s+[A-ZÀ-Ỹ]/.test(l) && l.length < 120)) return { heading: 2, text: l, page };
    return { text: l, page };
  });
}

async function extract(filePath, mime) {
  if (mime === MIME.DOCX) {
    const { value } = await mammoth.convertToHtml({ path: filePath });
    return htmlToLines(value);
  }
  if (mime === MIME.PDF) {
    const pages = [];
    await pdfParse(await fs.readFile(filePath), {
      pagerender: async (pageData) => {
        const content = await pageData.getTextContent();
        let last;
        let text = '';
        for (const item of content.items) {
          text += (last !== undefined && last !== item.transform[5] ? '\n' : ' ') + item.str;
          last = item.transform[5];
        }
        pages.push(text);
        return text;
      },
    });
    return pages.flatMap((t, i) => textToLines(t, i + 1));
  }
  if (mime === MIME.TXT || mime === MIME.MD) return textToLines(await fs.readFile(filePath, 'utf8'));
  throw new Error(`Định dạng chưa hỗ trợ: ${mime}`);
}

function mimeFromName(name) {
  const ext = String(name).toLowerCase().split('.').pop();
  return { pdf: MIME.PDF, docx: MIME.DOCX, txt: MIME.TXT, md: MIME.MD }[ext] || null;
}

module.exports = { extract, mimeFromName, htmlToLines, textToLines, SUPPORTED_MIME, MIME };
