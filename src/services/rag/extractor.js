'use strict';
/**
 * Trích văn bản từ PDF/DOCX/TXT thành các dòng có đánh dấu đề mục ('# ', '## ') và số trang.
 * DOCX: mammoth -> HTML để giữ đề mục (extractRawText làm mất cấu trúc).
 * PDF: pdf-parse, gom chữ theo từng trang để trích dẫn được "trang x".
 * XLSX/CSV: mỗi dòng dữ liệu thành một câu "Cột: giá trị; …" (bảng ngành, học phí, chỉ tiêu… tìm được theo từ khóa).
 * Ảnh (JPG/PNG/WEBP) và PDF scan không có lớp chữ: AI đọc thành chữ (ocrText -> linesFromOcr) ở ingestService.
 */
const fs = require('node:fs/promises');
const mammoth = require('mammoth');
// Import thẳng lib: index.js của pdf-parse@1 tự đọc file test khi chạy không có module.parent.
const pdfParse = require('pdf-parse/lib/pdf-parse.js');
const ExcelJS = require('exceljs');

const MIME = {
  PDF: 'application/pdf',
  DOCX: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  TXT: 'text/plain',
  MD: 'text/markdown',
  XLSX: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  CSV: 'text/csv',
  JPG: 'image/jpeg',
  PNG: 'image/png',
  WEBP: 'image/webp',
};
const IMAGE_MIME = new Set([MIME.JPG, MIME.PNG, MIME.WEBP]);
/** Định dạng AI đọc được trực tiếp (ảnh, PDF) khi không có lớp chữ. */
const OCR_MIME = new Set([MIME.PDF, ...IMAGE_MIME]);
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

const cellText = (v) => {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10).split('-').reverse().join('/');
  if (typeof v === 'object') return String(v.text ?? v.result ?? (v.richText ? v.richText.map((r) => r.text).join('') : '') ?? '');
  return String(v);
};

/** Bảng -> dòng: tiêu đề sheet là đề mục; dòng đầu có chữ là tên cột; mỗi dòng sau "Cột: giá trị; …". */
function tableToLines(title, rows) {
  const clean = rows.map((r) => r.map((c) => cellText(c).replace(/\s+/g, ' ').trim())).filter((r) => r.some(Boolean));
  if (!clean.length) return [];
  const header = clean[0];
  const lines = [{ heading: 1, text: title, page: null }];
  for (const r of clean.slice(1)) {
    const parts = r.map((v, i) => (v ? (header[i] && header[i] !== v ? `${header[i]}: ${v}` : v) : null)).filter(Boolean);
    if (parts.length) lines.push({ text: parts.join('; '), page: null });
  }
  if (lines.length === 1) lines.push({ text: header.filter(Boolean).join('; '), page: null });
  return lines;
}

function parseCsv(text) {
  const sep = (text.split('\n')[0].match(/;/g) || []).length > (text.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
  const rows = [];
  let row = []; let cur = ''; let q = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cur += '"'; i += 1; } else if (ch === '"') q = false; else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) { row.push(cur); cur = ''; } else if (ch === '\n') { row.push(cur.replace(/\r$/, '')); rows.push(row); row = []; cur = ''; } else cur += ch;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

/**
 * Văn bản AI đọc từ ảnh/PDF scan -> dòng. AI được yêu cầu đánh dấu "=== Trang n ===" để giữ số trang
 * khi trích dẫn, đề mục dạng markdown "#".
 */
function linesFromOcr(text) {
  const out = [];
  let page = null;
  for (const part of String(text || '').split(/^===\s*Trang\s+(\d+)\s*===\s*$/m)) {
    if (/^\d+$/.test(part.trim())) { page = Number(part.trim()); continue; }
    out.push(...textToLines(part, page));
  }
  return out;
}

async function extract(filePath, mime) {
  if (IMAGE_MIME.has(mime)) return []; // chỉ đọc được bằng AI (ingestService)
  if (mime === MIME.XLSX) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(filePath);
    const lines = [];
    wb.eachSheet((ws) => {
      const rows = [];
      ws.eachRow({ includeEmpty: false }, (r) => rows.push((r.values || []).slice(1)));
      lines.push(...tableToLines(ws.name, rows));
    });
    return lines;
  }
  if (mime === MIME.CSV) return tableToLines('Bảng dữ liệu', parseCsv((await fs.readFile(filePath, 'utf8')).replace(/^\uFEFF/, '')));
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
  return {
    pdf: MIME.PDF, docx: MIME.DOCX, txt: MIME.TXT, md: MIME.MD, xlsx: MIME.XLSX, csv: MIME.CSV,
    jpg: MIME.JPG, jpeg: MIME.JPG, png: MIME.PNG, webp: MIME.WEBP,
  }[ext] || null;
}

module.exports = { extract, mimeFromName, htmlToLines, textToLines, tableToLines, parseCsv, linesFromOcr, SUPPORTED_MIME, MIME, IMAGE_MIME, OCR_MIME };
