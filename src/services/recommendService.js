'use strict';
/**
 * M4 – Gợi ý ngành: lõi TẤT ĐỊNH, giải thích được.
 *   score = w.riasec × cosine(RIASEC thí sinh, RIASEC ngành)
 *         + w.subject × độ khớp môn thế mạnh
 *         + w.preference × độ khớp mong muốn
 *   Ràng buộc cứng (trình độ đầu vào không cho phép học hệ đó) -> loại hẳn.
 * LLM (nếu có) chỉ viết lời giải thích từ kết quả đã tính; KHÔNG được đổi thứ hạng.
 */
const { HttpError } = require('../utils/httpError');
const { uuid } = require('../utils/crypto');
const { RIASEC, RIASEC_ITEMS, SUBJECTS, EDUCATION, WORK_STYLES } = require('../constants/recommendQuestionnaire');
const { LEVELS } = require('../constants/catalog');
const majorRepository = require('../repositories/majorRepository');
const recommendationRepository = require('../repositories/recommendationRepository');
const { buildRecommendExplainPrompt } = require('./ai/promptBuilder');

const TYPES = Object.keys(RIASEC);
const LANGUAGE_OR_ABROAD = /Tiếng|Ngoại ngữ|Hàn Quốc/;

/** Điểm RIASEC 0–1 từ câu trả lời Likert 1–5. */
function riasecScores(likert) {
  const out = {};
  for (const t of TYPES) {
    const items = RIASEC_ITEMS.filter((i) => i.type === t);
    const vals = items.map((i) => Number(likert[i.id]));
    out[t] = vals.reduce((s, v) => s + (v - 1) / 4, 0) / items.length;
  }
  return out;
}

function cosine(a, b) {
  let dot = 0; let na = 0; let nb = 0;
  for (const t of TYPES) {
    const x = a[t] || 0; const y = b[t] || 0;
    dot += x * y; na += x * x; nb += y * y;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

function subjectMatch(ratings, weights) {
  const keys = Object.keys(weights || {});
  if (!keys.length) return 0.5;
  let s = 0; let w = 0;
  for (const k of keys) {
    const r = ratings[k] ? (Number(ratings[k]) - 1) / 4 : 0.5;
    s += r * weights[k]; w += weights[k];
  }
  return w ? s / w : 0.5;
}

function preferenceMatch(major, pref) {
  const parts = [];
  // trình độ mong muốn
  parts.push(!pref.desiredLevel || pref.desiredLevel === 'ANY' ? 1 : (major.levels.includes(pref.desiredLevel) ? 1 : 0.2));
  // môi trường làm việc
  if (pref.workStyle) parts.push((major.work_styles || []).includes(pref.workStyle) ? 1 : 0.3);
  // hỗ trợ học phí
  if (pref.wantsTuitionSupport) parts.push(major.state_support || major.enterprise_support ? 1 : 0.4);
  // học/làm việc nước ngoài
  if (pref.wantsAbroad) parts.push(LANGUAGE_OR_ABROAD.test(`${major.faculty} ${major.name}`) ? 1 : 0.5);
  return parts.reduce((s, v) => s + v, 0) / parts.length;
}

/** Hàm thuần: chấm điểm, lọc ràng buộc cứng, xếp hạng (unit test được). */
function score({ answers, majors, weights, topN }) {
  const user = riasecScores(answers.riasec);
  const allowed = EDUCATION[answers.education].allowedLevels;
  const levelFilter = answers.preferences?.desiredLevel && answers.preferences.desiredLevel !== 'ANY'
    ? [answers.preferences.desiredLevel].filter((l) => allowed.includes(l)) : allowed;
  const results = [];
  for (const m of majors) {
    const levels = m.levels.filter((l) => levelFilter.includes(l));
    if (!levels.length) continue; // ràng buộc cứng
    const parts = {
      riasec: cosine(user, m.riasec_profile),
      subject: subjectMatch(answers.subjects || {}, m.subject_weights),
      preference: preferenceMatch(m, answers.preferences || {}),
    };
    const total = weights.riasec * parts.riasec + weights.subject * parts.subject + weights.preference * parts.preference;
    results.push({ majorCode: m.code, name: m.name, faculty: m.faculty, levels, score: Math.round(total * 1000) / 10, parts: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, Math.round(v * 100)])), major: m });
  }
  results.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return { user, results: results.slice(0, topN) };
}

function reasonsFor(r, user, answers) {
  const reasons = [];
  const topUser = TYPES.slice().sort((a, b) => user[b] - user[a]).slice(0, 2);
  const topMajor = TYPES.slice().sort((a, b) => (r.major.riasec_profile[b] || 0) - (r.major.riasec_profile[a] || 0)).slice(0, 2);
  const shared = topUser.filter((t) => topMajor.includes(t));
  if (shared.length) reasons.push(`Sở thích nổi bật của em (${shared.map((t) => RIASEC[t]).join(', ')}) phù hợp với tính chất nghề.`);
  const strongSubjects = Object.keys(r.major.subject_weights || {}).filter((k) => Number(answers.subjects?.[k]) >= 4);
  if (strongSubjects.length) reasons.push(`Em tự đánh giá tốt môn ${strongSubjects.map((k) => SUBJECTS[k]).join(', ')} – môn quan trọng của ngành.`);
  if (answers.preferences?.workStyle && (r.major.work_styles || []).includes(answers.preferences.workStyle)) {
    reasons.push(`Môi trường làm việc (${WORK_STYLES[answers.preferences.workStyle].toLowerCase()}) đúng mong muốn của em.`);
  }
  if (answers.preferences?.wantsTuitionSupport && (r.major.state_support || r.major.enterprise_support)) {
    reasons.push('Ngành nằm trong danh sách có chính sách hỗ trợ học phí (mức cụ thể cần xác nhận với Trung tâm Tuyển sinh).');
  }
  reasons.push(`Có thể học ở hệ: ${r.levels.map((l) => LEVELS[l]).join(', ')}.`);
  return reasons;
}

function validateAnswers(a) {
  if (!a || typeof a !== 'object') throw new HttpError(400, 'Thiếu câu trả lời');
  if (!EDUCATION[a.education]) throw new HttpError(400, 'Vui lòng chọn trình độ học vấn hiện tại');
  for (const item of RIASEC_ITEMS) {
    const v = Number(a.riasec?.[item.id]);
    if (!Number.isInteger(v) || v < 1 || v > 5) throw new HttpError(400, 'Vui lòng trả lời đủ các câu về sở thích (thang 1–5)');
  }
  for (const [k, v] of Object.entries(a.subjects || {})) {
    if (!SUBJECTS[k] || !Number.isInteger(Number(v)) || v < 1 || v > 5) throw new HttpError(400, 'Điểm tự đánh giá môn học không hợp lệ');
  }
  const p = a.preferences || {};
  if (p.desiredLevel && p.desiredLevel !== 'ANY' && !LEVELS[p.desiredLevel]) throw new HttpError(400, 'Trình độ mong muốn không hợp lệ');
  if (p.workStyle && !WORK_STYLES[p.workStyle]) throw new HttpError(400, 'Môi trường làm việc không hợp lệ');
}

function createRecommendService({ db, configService, llm, logger = console }) {
  async function recommend({ answers, sessionId = null, visitorHash = null }) {
    validateAnswers(answers);
    const majors = await majorRepository.listForScoring(db, configService.get('CURRENT_ADMISSION_YEAR'));
    const { user, results } = score({ answers, majors, weights: configService.get('RECOMMEND_WEIGHTS'), topN: configService.get('RECOMMEND_TOP_N') });
    const output = results.map((r) => ({
      majorCode: r.majorCode, name: r.name, faculty: r.faculty, levels: r.levels, score: r.score, parts: r.parts,
      reasons: reasonsFor(r, user, answers), careers: r.major.career_paths || [],
    }));
    let explanation = null;
    if (output.length && llm.available()) {
      try {
        const p = buildRecommendExplainPrompt({
          results: output.map((o) => ({ ten_nganh: o.name, khoa: o.faculty, ly_do: o.reasons })),
          answersSummary: `Trình độ: ${EDUCATION[answers.education].label}; nhóm sở thích cao nhất: ${TYPES.slice().sort((a, b) => user[b] - user[a]).slice(0, 2).map((t) => RIASEC[t]).join(', ')}`,
        });
        explanation = (await llm.generate({ system: p.system, prompt: p.prompt, maxTokens: 400 })).text || null;
      } catch (err) { logger.warn('[recommend] LLM giải thích lỗi:', err.message); }
    }
    const id = uuid();
    const riasecPercent = Object.fromEntries(TYPES.map((t) => [t, Math.round(user[t] * 100)]));
    await recommendationRepository.insert(db, {
      id, sessionId, visitorHash, answers, riasecScores: riasecPercent,
      results: output.map(({ majorCode, score: s, parts, reasons }) => ({ majorCode, score: s, parts, reasons })), explanation,
    }).catch((err) => logger.warn('[recommend] không lưu được phiên:', err.message));
    return { id, riasec: riasecPercent, riasecLabels: RIASEC, results: output, explanation, sampleProfileNotice: true };
  }

  return {
    recommend,
    questionnaire: () => ({ riasecItems: RIASEC_ITEMS, riasecLabels: RIASEC, subjects: SUBJECTS, education: EDUCATION, workStyles: WORK_STYLES, levels: LEVELS }),
  };
}

module.exports = { createRecommendService, score, riasecScores, cosine, subjectMatch };
