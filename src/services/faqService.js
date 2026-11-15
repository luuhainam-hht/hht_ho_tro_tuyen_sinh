'use strict';
/**
 * FAQ: cán bộ soạn (DRAFT) -> Lãnh đạo duyệt (APPROVED) -> lưu trữ (ARCHIVED).
 * Sửa nội dung một FAQ đã duyệt đưa nó về DRAFT: câu trả lời trả nguyên văn cho thí sinh
 * nên mọi thay đổi phải được duyệt lại.
 */
const { HttpError } = require('../utils/httpError');
const { NOW } = require('../utils/sqlUpdate');
const { normalizeVi } = require('../utils/textNormalize');
const faqRepository = require('../repositories/faqRepository');
const auditRepository = require('../repositories/auditRepository');

const matchText = (question, variants) => normalizeVi([question, ...variants].join(' | '));

function createFaqService({ db, configService, broadcast }) {
  async function create({ question, answer, variants = [], topic = 'KHAC', sourceCodes = [], actor, ip, documentId = null }) {
    const faq = await db.withTransaction(async (c) => {
      const f = await faqRepository.insert(c, {
        topic, question, answer, variants, matchTextNorm: matchText(question, variants), sourceCodes, documentId,
        admissionYear: configService.get('CURRENT_ADMISSION_YEAR'), status: 'DRAFT', createdBy: actor.id,
      });
      await auditRepository.insert(c, { actorId: actor.id, action: 'FAQ_CREATE', targetType: 'FAQ', targetId: f.id, ip });
      return f;
    });
    broadcast('FAQ_UPDATED', { id: Number(faq.id), status: faq.status });
    return faq;
  }

  async function update(id, { question, answer, variants, topic, sourceCodes, actor, ip }) {
    const faq = await db.withTransaction(async (c) => {
      const f = await faqRepository.findByIdForUpdate(c, id);
      if (!f) throw new HttpError(404, 'Không tìm thấy câu hỏi');
      if (f.status === 'ARCHIVED') throw new HttpError(409, 'Câu hỏi đã lưu trữ, không sửa được');
      const q = question ?? f.question;
      const v = variants ?? f.variants;
      const changedContent = (question && question !== f.question) || (answer && answer !== f.answer) || variants;
      const updated = await faqRepository.update(c, id, {
        question: q, answer: answer ?? f.answer, variants: v, topic: topic ?? f.topic, source_codes: sourceCodes ?? f.source_codes,
        match_text_norm: matchText(q, v),
        ...(changedContent ? { status: 'DRAFT', embedding: null, approved_by: null, approved_at: null } : {}),
      });
      await auditRepository.insert(c, { actorId: actor.id, action: 'FAQ_UPDATE', targetType: 'FAQ', targetId: id, payload: { backToDraft: Boolean(changedContent && f.status === 'APPROVED') }, ip });
      return updated;
    });
    broadcast('FAQ_UPDATED', { id: Number(id), status: faq.status });
    return faq;
  }

  async function setStatus(id, to, { actor, ip, reason = null }) {
    const allowedFrom = { APPROVED: ['DRAFT'], ARCHIVED: ['DRAFT', 'APPROVED'], DRAFT: ['ARCHIVED'] }[to];
    const faq = await db.withTransaction(async (c) => {
      const f = await faqRepository.findByIdForUpdate(c, id);
      if (!f) throw new HttpError(404, 'Không tìm thấy câu hỏi');
      if (!allowedFrom.includes(f.status)) throw new HttpError(409, `Câu hỏi đang ở trạng thái ${f.status}`);
      const updated = await faqRepository.update(c, id, {
        status: to, ...(to === 'APPROVED' ? { approved_by: actor.id, approved_at: NOW } : {}),
      });
      await auditRepository.insert(c, { actorId: actor.id, action: `FAQ_${to}`, targetType: 'FAQ', targetId: id, reason, ip });
      return updated;
    });
    broadcast('FAQ_UPDATED', { id: Number(id), status: to });
    return faq;
  }

  return {
    create, update,
    approve: (id, o) => setStatus(id, 'APPROVED', o),
    archive: (id, o) => setStatus(id, 'ARCHIVED', o),
    restore: (id, o) => setStatus(id, 'DRAFT', o),
    list: (filter) => faqRepository.list(db, filter),
  };
}

module.exports = { createFaqService, matchText };
