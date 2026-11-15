'use strict';
/**
 * Chuyển câu hỏi cho cán bộ (chỉ khi thí sinh tự đồng ý để lại liên hệ).
 *   NEW -> ASSIGNED -> ANSWERED -> CLOSED   (NEW -> CLOSED khi trùng/spam)
 * "Đưa vào FAQ": tạo FAQ DRAFT chờ Lãnh đạo duyệt, câu hỏi được che dữ liệu cá nhân.
 */
const { HttpError } = require('../utils/httpError');
const { NOW } = require('../utils/sqlUpdate');
const { maskPii } = require('./piiFilter');
const handoffRepository = require('../repositories/handoffRepository');
const faqRepository = require('../repositories/faqRepository');
const auditRepository = require('../repositories/auditRepository');
const chatRepository = require('../repositories/chatRepository');
const { matchText } = require('./faqService');

const TRANSITIONS = { NEW: ['ASSIGNED', 'ANSWERED', 'CLOSED'], ASSIGNED: ['ANSWERED', 'CLOSED', 'ASSIGNED'], ANSWERED: ['CLOSED'], CLOSED: [] };

function createHandoffService({ db, configService, broadcast, classifier }) {
  async function create({ sessionId, question, contactName, contactPhone, contactEmail, consent }) {
    if (!configService.get('HANDOFF_ENABLED')) throw new HttpError(403, 'Chức năng gửi câu hỏi cho cán bộ đang tạm tắt');
    if (consent !== true) throw new HttpError(400, 'Bạn cần đồng ý để nhà trường dùng thông tin liên hệ trả lời câu hỏi');
    if (!contactPhone && !contactEmail) throw new HttpError(400, 'Vui lòng để lại số điện thoại hoặc email');
    if (sessionId && !(await chatRepository.findSession(db, sessionId))) sessionId = null;
    const h = await db.withTransaction(async (c) => {
      const row = await handoffRepository.insert(c, { sessionId, question, contactName, contactPhone, contactEmail, consent });
      if (sessionId) {
        await chatRepository.insertMessage(c, {
          sessionId, role: 'ASSISTANT', source: 'HANDOFF',
          content: 'Đã chuyển câu hỏi của bạn tới cán bộ tuyển sinh. Cán bộ sẽ liên hệ lại theo thông tin bạn để lại.',
        });
      }
      return row;
    });
    broadcast('HANDOFF_CREATED', { id: Number(h.id), question: maskPii(question).masked.slice(0, 200) });
    return { id: Number(h.id), status: h.status };
  }

  async function transition(id, to, { actor, ip, answer = null, assignTo = null }) {
    const h = await db.withTransaction(async (c) => {
      const cur = await handoffRepository.findByIdForUpdate(c, id);
      if (!cur) throw new HttpError(404, 'Không tìm thấy yêu cầu');
      if (!TRANSITIONS[cur.status].includes(to)) throw new HttpError(409, `Yêu cầu đang ở trạng thái ${cur.status}`);
      const fields = { status: to };
      if (to === 'ASSIGNED') fields.assigned_to = assignTo ?? actor.id;
      if (to === 'ANSWERED') {
        if (!answer) throw new HttpError(400, 'Vui lòng nhập nội dung trả lời');
        Object.assign(fields, { answer, answered_at: NOW, assigned_to: cur.assigned_to ?? actor.id });
      }
      const updated = await handoffRepository.update(c, id, fields);
      await auditRepository.insert(c, { actorId: actor.id, action: `HANDOFF_${to}`, targetType: 'HANDOFF', targetId: id, ip });
      return updated;
    });
    broadcast('HANDOFF_UPDATED', { id: Number(id), status: to });
    return h;
  }

  async function promoteToFaq(id, { actor, ip }) {
    const result = await db.withTransaction(async (c) => {
      const h = await handoffRepository.findByIdForUpdate(c, id);
      if (!h) throw new HttpError(404, 'Không tìm thấy yêu cầu');
      if (h.status !== 'ANSWERED' && h.status !== 'CLOSED') throw new HttpError(409, 'Chỉ đưa vào FAQ sau khi đã trả lời');
      if (!h.answer) throw new HttpError(409, 'Yêu cầu chưa có câu trả lời');
      if (h.faq_id) throw new HttpError(409, 'Câu hỏi này đã được đưa vào FAQ');
      const question = maskPii(h.question).masked;
      const cls = classifier.classify(question);
      const faq = await faqRepository.insert(c, {
        topic: cls.intent, question, answer: h.answer, variants: [], matchTextNorm: matchText(question, []),
        admissionYear: configService.get('CURRENT_ADMISSION_YEAR'), status: 'DRAFT', createdBy: actor.id,
        internalNote: `Tạo từ câu hỏi chuyển cán bộ #${id}`,
      });
      await handoffRepository.update(c, id, { promote_to_faq: true, faq_id: faq.id });
      await auditRepository.insert(c, { actorId: actor.id, action: 'HANDOFF_PROMOTE_FAQ', targetType: 'FAQ', targetId: faq.id, payload: { handoffId: id }, ip });
      return faq;
    });
    broadcast('FAQ_UPDATED', { id: Number(result.id), status: 'DRAFT' });
    return result;
  }

  async function detail(id) {
    const { rows } = await db.query('SELECT * FROM handoff_requests WHERE id = ?', [id]);
    if (!rows[0]) throw new HttpError(404, 'Không tìm thấy yêu cầu');
    return { ...rows[0], context: await handoffRepository.contextMessages(db, rows[0].session_id) };
  }

  return { create, transition, promoteToFaq, detail, list: (f) => handoffRepository.list(db, f) };
}

module.exports = { createHandoffService };
