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

  const SOURCE_NOTE = { FAQ: 'Nguồn', RAG: 'Nguồn', CACHE: 'Nguồn' };

  function bubble(role, text, meta) {
    const node = el('div', { class: `msg msg--${role}` }, text);
    if (meta) {
      const m = el('div', { class: 'msg-meta' });
      if (meta.citations?.length) {
        m.append(el('div', {}, `${SOURCE_NOTE[meta.source] || 'Nguồn'}: `,
          meta.citations.map((c, i) => [i ? '; ' : '', c.url ? el('a', { href: c.url, target: '_blank', rel: 'noopener' }, c.title) : c.title, c.pages ? ` (tr. ${c.pages})` : ''])));
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
    log.scrollTop = log.scrollHeight;
    return node;
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

  async function ask(text) {
    const q = text.trim();
    if (!q) return;
    lastQuestion = q;
    bubble('user', q);
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
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && embedded) window.parent.postMessage('hht-chat-close', location.origin); });

  (async () => {
    const meta = await hht.meta().catch(() => ({ config: {} }));
    handoffEnabled = meta.config.HANDOFF_ENABLED !== false;
    if (meta.config.AI_ASSISTANT_NAME) $('#chat-title').textContent = meta.config.AI_ASSISTANT_NAME;
    bubble('bot', meta.config.CHAT_GREETING || 'Xin chào! Bạn cần hỏi gì về tuyển sinh?');
    if (p.get('q')) ask(p.get('q'));
    $('#msg').focus();
  })();
})();
