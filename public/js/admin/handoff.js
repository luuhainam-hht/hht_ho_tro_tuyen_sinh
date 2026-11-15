(function () {
  'use strict';
  const STATUS = { NEW: ['Mới', 'badge--stop'], ASSIGNED: ['Đang xử lý', 'badge--wait'], ANSWERED: ['Đã trả lời', 'badge--go'], CLOSED: ['Đã đóng', ''] };

  async function refreshBadge() {
    if (!admin.can('HANDOFF')) return;
    try { const { items } = await apiClient.get('/api/admin/handoffs?status=NEW'); admin.setBadge('handoff', items.length); } catch { /* bỏ qua */ }
  }
  admin.onRefresh('handoff', (type) => { if (type.startsWith('HANDOFF')) refreshBadge(); });
  setTimeout(refreshBadge, 1500);

  admin.register({
    id: 'handoff', title: 'Câu hỏi chờ cán bộ', perm: 'HANDOFF', events: ['HANDOFF_CREATED', 'HANDOFF_UPDATED'],
    async render(root) {
      const status = root.dataset.status || '';
      const { items } = await apiClient.get(`/api/admin/handoffs${status ? `?status=${status}` : ''}`);
      refreshBadge();
      root.replaceChildren(
        el('div', { class: 'toolbar' }, ['', 'NEW', 'ASSIGNED', 'ANSWERED', 'CLOSED'].map((s) => el('button', { class: `btn btn--sm ${s === status ? 'btn--primary' : ''}`, 'data-action': 'handoff-filter', 'data-value': s }, s ? STATUS[s][0] : 'Tất cả'))),
        admin.table(['Thời gian', 'Câu hỏi', 'Liên hệ', 'Trạng thái', ''], items.map((h) => el('tr', {},
          el('td', {}, admin.dt(h.created_at)),
          el('td', {}, h.question.slice(0, 160)),
          el('td', { class: 'small' }, [h.contact_name, h.contact_phone, h.contact_email].filter(Boolean).join(' · ')),
          el('td', {}, el('span', { class: `badge ${STATUS[h.status][1]}` }, STATUS[h.status][0]), h.assigned_to_name ? el('div', { class: 'small muted' }, h.assigned_to_name) : null),
          el('td', {}, el('button', { class: 'btn btn--sm', 'data-action': 'handoff-open', 'data-id': h.id }, 'Mở')))), 'Không có câu hỏi nào'),
        el('div', { id: 'handoff-detail' }));
    },
  });

  async function openDetail(id) {
    const h = await apiClient.get(`/api/admin/handoffs/${id}`);
    const box = $('#handoff-detail');
    box.replaceChildren(el('section', { class: 'panel mt-m' },
      el('h3', {}, `Yêu cầu #${h.id}`),
      el('p', {}, el('strong', {}, 'Câu hỏi: '), h.question),
      el('p', { class: 'small' }, `Liên hệ: ${[h.contact_name, h.contact_phone, h.contact_email].filter(Boolean).join(' · ')}`),
      h.context.length ? [el('h3', {}, 'Hội thoại trước đó'), el('div', { class: 'chat-log' }, h.context.map((m) => el('div', { class: `msg ${m.role === 'USER' ? 'msg--user' : 'msg--bot'}` }, m.content)))] : null,
      h.status === 'ANSWERED' || h.status === 'CLOSED'
        ? [el('p', {}, el('strong', {}, 'Đã trả lời: '), h.answer || '—'),
          el('div', { class: 'btn-row' },
            h.status === 'ANSWERED' ? el('button', { class: 'btn btn--sm', 'data-action': 'handoff-close', 'data-id': h.id }, 'Đóng yêu cầu') : null,
            h.answer && !h.faq_id ? el('button', { class: 'btn btn--sm btn--tag', 'data-action': 'handoff-promote', 'data-id': h.id }, 'Đưa vào FAQ (chờ duyệt)') : el('span', { class: 'small muted' }, h.faq_id ? 'Đã đưa vào FAQ' : ''))]
        : el('form', { class: 'form', 'data-action': 'handoff-answer', 'data-id': h.id },
          el('label', {}, 'Nội dung đã trả lời thí sinh (lưu để thống kê và tạo FAQ)', el('textarea', { name: 'answer', rows: '4', required: true })),
          el('div', { class: 'btn-row' },
            h.status === 'NEW' ? el('button', { type: 'button', class: 'btn btn--sm', 'data-action': 'handoff-assign', 'data-id': h.id }, 'Nhận xử lý') : null,
            el('button', { type: 'submit', class: 'btn btn--sm btn--primary' }, 'Lưu câu trả lời'),
            el('button', { type: 'button', class: 'btn btn--sm btn--ghost', 'data-action': 'handoff-close', 'data-id': h.id }, 'Đóng (trùng/không hợp lệ)')))));
    box.scrollIntoView({ behavior: 'smooth' });
  }

  const act = (path, body) => apiClient.post(path, body).then(() => { toast('Đã cập nhật', 'ok'); admin.reload(); }).catch((e) => toast(e.message, 'error'));
  actionDelegate.register({
    'handoff-filter': (b) => { $('#tab').dataset.status = b.dataset.value; admin.reload(); },
    'handoff-open': (b) => openDetail(b.dataset.id).catch((e) => toast(e.message, 'error')),
    'handoff-assign': (b) => act(`/api/admin/handoffs/${b.dataset.id}/assign`, {}),
    'handoff-answer': (f) => act(`/api/admin/handoffs/${f.dataset.id}/answer`, { answer: f.answer.value }),
    'handoff-close': (b) => act(`/api/admin/handoffs/${b.dataset.id}/close`, {}),
    'handoff-promote': (b) => act(`/api/admin/handoffs/${b.dataset.id}/promote`, {}),
  });
})();
