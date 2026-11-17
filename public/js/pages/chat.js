(function () {
  'use strict';
  const SESSION_KEY = 'hht.chatSession';
  const p = hht.params();
  const embedded = p.get('embedded') === '1' && window.parent !== window;
  const majorCode = p.get('major') || null;
  let sessionId = null;
  let handoffEnabled = true;
  let lastQuestion = '';
  const log = $('#log');

  if (!embedded) $('#close-btn').classList.add('hidden');

  const SOURCE_NOTE = { FAQ: 'Nguồn', RAG: 'Nguồn', CACHE: 'Nguồn', WEB: 'Tham khảo trên Internet', INFO: 'Nguồn' };
  const LONG_ANSWER_PX = 0.55; // câu trả lời cao hơn 55% khung chat -> cuộn về ĐẦU câu trả lời

  /**
   * Cuộn khung chat: câu trả lời ngắn -> xuống cuối như thường; câu trả lời dài -> đặt đầu câu trả lời
   * ở mép trên để người đọc không phải kéo ngược lên tìm chỗ bắt đầu.
   */
  function scrollToMessage(node, { forceTop = false } = {}) {
    const long = node.offsetHeight > log.clientHeight * LONG_ANSWER_PX;
    if (forceTop || long) {
      log.scrollTop += node.getBoundingClientRect().top - log.getBoundingClientRect().top - 8;
    } else {
      log.scrollTop = log.scrollHeight;
    }
    return long;
  }

  function bubble(role, text, meta) {
    const node = el('div', { class: `msg msg--${role}` }, text);
    if (meta) {
      const m = el('div', { class: 'msg-meta' });
      if (meta.source === 'WEB') {
        const official = meta.citations?.some((c) => c.official);
        m.append(el('div', { class: 'web-note' }, meta.webMode === 'GENERAL'
          ? 'Thông tin tham khảo tra cứu trên Internet (ngoài nội dung tuyển sinh).'
          : official
            ? 'Tra cứu trên website chính thức của Nhà trường – thông tin có thể đã cập nhật, vui lòng đối chiếu với Trung tâm Tuyển sinh.'
            : 'Thông tin tra cứu trên Internet, chưa phải văn bản chính thức của Nhà trường – vui lòng đối chiếu với nguồn hoặc hỏi Trung tâm Tuyển sinh.'));
      }
      if (meta.citations?.length) {
        m.append(el('div', {}, `${SOURCE_NOTE[meta.source] || 'Nguồn'}: `,
          meta.citations.map((c, i) => [i ? '; ' : '', c.url ? el('a', { href: c.url, target: '_blank', rel: 'noopener noreferrer' }, c.title) : c.title, c.official ? ' (chính thức)' : '', c.pages ? ` (tr. ${c.pages})` : ''])));
      }
      if (meta.suggestions?.length) {
        m.append(el('div', {}, 'Có thể bạn muốn hỏi:'),
          el('div', { class: 'msg-actions' }, meta.suggestions.map((s) => el('button', { type: 'button', 'data-action': 'suggest', 'data-q': s.question }, s.question))));
      }
      const actions = el('div', { class: 'msg-actions' });
      if (meta.messageId && meta.source !== 'RULE') {
        actions.append(
          el('button', { type: 'button', 'data-action': 'rate', 'data-id': meta.messageId, 'data-v': '1', 'aria-pressed': 'false' }, 'Hữu ích'),
          el('button', { type: 'button', 'data-action': 'rate', 'data-id': meta.messageId, 'data-v': '-1', 'aria-pressed': 'false' }, 'Chưa đúng'));
      }
      if (handoffEnabled && (meta.handoffSuggested || meta.source === 'FALLBACK')) actions.append(el('button', { type: 'button', 'data-action': 'open-handoff' }, 'Gửi câu hỏi cho cán bộ'));
      if (actions.children.length) m.append(actions);
      if (m.children.length) node.append(m);
    }
    log.append(node);
    if (role === 'bot' && meta) {
      if (scrollToMessage(node)) node.append(el('button', { type: 'button', class: 'to-top', 'data-action': 'to-answer-top' }, '↑ Về đầu câu trả lời'));
    } else {
      log.scrollTop = log.scrollHeight;
    }
    return node;
  }

  // ---------- Giải thích hệ đào tạo / hỗ trợ học phí (bấm cột ở trang Ngành học) ----------
  const EXPLAIN_Q = {
    level: { SO_CAP: 'Hệ Sơ cấp (SC) là gì?', HE_9_PLUS: 'Hệ 9+ là gì?', TRUNG_CAP: 'Hệ Trung cấp (TC) là gì?', CAO_DANG: 'Hệ Cao đẳng (CĐ) là gì?' },
    support: { NHA_NUOC: 'Nhà nước hỗ trợ học phí thế nào?', DOANH_NGHIEP: 'Doanh nghiệp hỗ trợ học phí thế nào?', SINH_VIEN: 'Sinh viên phải tự đóng bao nhiêu?' },
  };
  const FOLLOW_UP = {
    SO_CAP: ['Trường có đào tạo ngắn hạn, cấp chứng chỉ không?'],
    HE_9_PLUS: ['Học phí hệ 9+ bao nhiêu?', 'Hệ 9+ có những ngành nào, chỉ tiêu bao nhiêu?', 'Hồ sơ và thời gian nộp hồ sơ hệ 9+?'],
    TRUNG_CAP: ['Điều kiện để học Trung cấp là gì?', 'Hồ sơ xét tuyển Cao đẳng, Trung cấp gồm những gì?'],
    CAO_DANG: ['Trường có tuyển sinh liên thông không?', 'Hồ sơ xét tuyển Cao đẳng, Trung cấp gồm những gì?'],
    NHA_NUOC: ['Ngành nào được Nhà nước hỗ trợ 70% học phí?', 'Hà Nội hỗ trợ 100% học phí là như thế nào?'],
    DOANH_NGHIEP: ['Doanh nghiệp hỗ trợ học phí ngành nào?'],
    SINH_VIEN: ['Học phí của trường là bao nhiêu?', 'Trường có học bổng không?'],
  };
  let infoPromise = null;
  const info = () => (infoPromise ||= apiClient.get('/api/handbook/info'));

  async function explain(spec) {
    const [kind, code] = String(spec || '').split(':');
    const question = EXPLAIN_Q[kind]?.[code];
    if (!question) return;
    bubble('user', question);
    try {
      const data = await info();
      const item = (kind === 'level' ? data.levels : data.supports)[code];
      if (!item) { await ask(question, { echo: false }); return; }
      bubble('bot', [el('strong', {}, item.title), '\n', item.detail], {
        source: 'INFO', citations: [{ title: 'Thông tin tuyển sinh của Nhà trường', url: '/nganh.html' }],
        suggestions: (FOLLOW_UP[code] || []).map((q) => ({ question: q })),
      });
    } catch {
      await ask(question, { echo: false });
    }
  }

  async function ensureSession() {
    if (sessionId) return sessionId;
    try { sessionId = sessionStorage.getItem(SESSION_KEY); } catch { /* bỏ qua */ }
    if (!sessionId) {
      const s = await apiClient.post('/api/chat/sessions', {});
      sessionId = s.sessionId;
      handoffEnabled = s.handoffEnabled;
      try { sessionStorage.setItem(SESSION_KEY, sessionId); } catch { /* bỏ qua */ }
    }
    return sessionId;
  }

  async function ask(text, { echo = true } = {}) {
    const q = text.trim();
    if (!q) return;
    lastQuestion = q;
    if (echo) bubble('user', q);
    const typing = el('div', { class: 'typing' }, 'Đang trả lời…');
    log.append(typing);
    try {
      const r = await apiClient.post('/api/chat/messages', { sessionId: await ensureSession(), message: q, majorCode });
      typing.remove();
      bubble('bot', r.answer, r);
    } catch (e) {
      typing.remove();
      if (e.status === 404) { sessionId = null; try { sessionStorage.removeItem(SESSION_KEY); } catch { /* */ } }
      bubble('bot', e.status === 429 ? e.message : `Chưa gửi được câu hỏi. ${e.message}`);
    }
  }

  function openHandoff() {
    const box = $('#handoff');
    box.classList.remove('hidden');
    box.replaceChildren(el('form', { class: 'form', 'data-action': 'send-handoff' },
      el('strong', {}, 'Gửi câu hỏi cho cán bộ tuyển sinh'),
      el('label', {}, 'Câu hỏi', el('textarea', { name: 'question', rows: '2', maxlength: '2000', required: true }, lastQuestion)),
      el('div', { class: 'form-grid' },
        el('label', {}, 'Họ tên', el('input', { name: 'contactName', maxlength: '100' })),
        el('label', {}, 'Số điện thoại', el('input', { name: 'contactPhone', inputmode: 'tel', maxlength: '15' })),
        el('label', {}, 'Email', el('input', { name: 'contactEmail', type: 'email', maxlength: '254' }))),
      el('label', { class: 'check' }, el('input', { type: 'checkbox', name: 'consent', required: true }),
        el('span', { class: 'small' }, 'Tôi đồng ý để Nhà trường dùng số điện thoại/email này để trả lời câu hỏi.')),
      el('div', { class: 'btn-row' }, el('button', { class: 'btn btn--tag btn--sm', type: 'submit' }, 'Gửi cho cán bộ'), el('button', { class: 'btn btn--sm', type: 'button', 'data-action': 'close-handoff' }, 'Để sau'))));
    box.querySelector('textarea').value = lastQuestion;
  }

  actionDelegate.register({
    send(form) { const v = form.message.value; form.reset(); return ask(v); },
    suggest: (b) => ask(b.dataset.q),
    async rate(b) {
      try {
        await apiClient.post(`/api/chat/messages/${b.dataset.id}/rating`, { sessionId, rating: Number(b.dataset.v) });
        b.parentElement.querySelectorAll('[data-action="rate"]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      } catch (e) { toast(e.message, 'error'); }
    },
    'open-handoff': openHandoff,
    'close-handoff': () => $('#handoff').classList.add('hidden'),
    async 'send-handoff'(form) {
      const f = Object.fromEntries(new FormData(form));
      if (!f.contactPhone && !f.contactEmail) { toast('Vui lòng để lại số điện thoại hoặc email.', 'error'); return; }
      try {
        await apiClient.post('/api/chat/handoff', { sessionId: await ensureSession(), question: f.question, contactName: f.contactName || null, contactPhone: f.contactPhone || null, contactEmail: f.contactEmail || null, consent: f.consent === 'on' });
        $('#handoff').classList.add('hidden');
        bubble('bot', 'Đã chuyển câu hỏi tới cán bộ tuyển sinh. Cán bộ sẽ liên hệ lại với bạn trong giờ làm việc.');
      } catch (e) { toast(e.message, 'error'); }
    },
    close: () => window.parent.postMessage('hht-chat-close', location.origin),
    'to-answer-top'(b) { scrollToMessage(b.closest('.msg'), { forceTop: true }); },
  });

  // Trang chứa khung chat gửi lệnh (hỏi / giải thích) mà không tải lại khung -> giữ cuộc trò chuyện.
  window.addEventListener('message', (e) => {
    if (e.origin !== location.origin || e.data?.type !== 'hht-chat-command') return;
    if (e.data.explain) explain(e.data.explain);
    else if (e.data.question) ask(e.data.question);
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && embedded) window.parent.postMessage('hht-chat-close', location.origin); });

  (async () => {
    const meta = await hht.meta().catch(() => ({ config: {} }));
    handoffEnabled = meta.config.HANDOFF_ENABLED !== false;
    if (meta.config.AI_ASSISTANT_NAME) $('#chat-title').textContent = meta.config.AI_ASSISTANT_NAME;
    bubble('bot', meta.config.CHAT_GREETING || 'Xin chào! Bạn cần hỏi gì về tuyển sinh?');
    if (p.get('explain')) explain(p.get('explain'));
    else if (p.get('q')) ask(p.get('q'));
    $('#msg').focus();
  })();
})();
