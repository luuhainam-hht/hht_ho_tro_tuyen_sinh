#!/usr/bin/env node
'use strict';
/**
 * Đánh giá trợ lý (phục vụ nghiệm thu): đọc test/eval/golden.jsonl
 *   {question, expected_facts[], expected_doc, should_refuse}
 * -> CSV chi tiết + tóm tắt: tỉ lệ đúng ý, dẫn nguồn đúng, từ chối đúng, độ trễ p50/p95, token TB.
 * Chạy trước và sau thử nghiệm để so sánh:  node scripts/eval-rag.js [file.jsonl] [out.csv]
 */
const fs = require('node:fs');
const path = require('node:path');
const { createContainer } = require('../src/container');
const { uuid } = require('../src/utils/crypto');
const { normalizeVi } = require('../src/utils/textNormalize');
const chatRepository = require('../src/repositories/chatRepository');

const pct = (a, b) => (b ? `${((a / b) * 100).toFixed(1)}%` : '–');
const percentile = (arr, p) => { const s = [...arr].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : 0; };
const csv = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

(async () => {
  const file = process.argv[2] || path.join(__dirname, '..', 'test', 'eval', 'golden.jsonl');
  const out = process.argv[3] || path.join(__dirname, '..', 'test', 'eval', `ket-qua-${Date.now()}.csv`);
  const cases = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const c = createContainer({ logger: { info() {}, warn() {}, error: console.error } });
  await c.configService.loadAll();
  await c.refreshMajors();
  const rows = [];
  for (const t of cases) {
    const s = await chatRepository.createSession(c.db, { id: uuid(), channel: 'WEB', visitorHash: 'eval' });
    const r = await c.answerService.answer({ sessionId: s.id, message: t.question });
    const refused = r.source === 'FALLBACK';
    const ans = normalizeVi(r.answer);
    const factsHit = (t.expected_facts || []).filter((f) => ans.includes(normalizeVi(f))).length;
    const correct = t.should_refuse ? refused : !refused && factsHit === (t.expected_facts || []).length;
    const citeOk = t.should_refuse || !t.expected_doc || r.citations.some((x) => x.sourceCode === t.expected_doc);
    const msg = (await c.db.query('SELECT tokens_in, tokens_out FROM chat_messages WHERE id = ?', [r.messageId])).rows[0] || {};
    rows.push({ ...t, source: r.source, correct, citeOk, refused, latency: r.latencyMs, tokens: (msg.tokens_in || 0) + (msg.tokens_out || 0), answer: r.answer });
  }
  fs.writeFileSync(out, `﻿câu hỏi,nguồn trả lời,đúng ý,dẫn nguồn đúng,từ chối,độ trễ ms,token,câu trả lời\n${rows.map((r) => [r.question, r.source, r.correct, r.citeOk, r.refused, r.latency, r.tokens, r.answer].map(csv).join(',')).join('\n')}\n`);
  const answerable = rows.filter((r) => !r.should_refuse);
  const refuse = rows.filter((r) => r.should_refuse);
  console.log(`Số câu: ${rows.length}
Trả lời đúng ý:        ${pct(answerable.filter((r) => r.correct).length, answerable.length)}
Dẫn nguồn đúng:        ${pct(answerable.filter((r) => r.citeOk).length, answerable.length)}
Từ chối đúng (ngoài phạm vi): ${pct(refuse.filter((r) => r.correct).length, refuse.length)}
Độ trễ p50 / p95:      ${percentile(rows.map((r) => r.latency), 50)} / ${percentile(rows.map((r) => r.latency), 95)} ms
Token trung bình:      ${(rows.reduce((s, r) => s + r.tokens, 0) / rows.length).toFixed(0)}
Chi tiết: ${out}`);
  await c.db.end();
})().catch((e) => { console.error(e); process.exit(1); });
