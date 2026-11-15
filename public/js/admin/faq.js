(function () {
  'use strict';
  const STATUS = { DRAFT: ['Chờ duyệt', 'badge--wait'], APPROVED: ['Đã duyệt', 'badge--go'], ARCHIVED: ['Lưu trữ', ''] };
  let topics = {};

  function editor(f = {}) {
    return el('form', { class: 'form panel mt-m', 'data-action': 'faq-save', 'data-id': f.id || '' },
      el('h3', {}, f.id ? `Sửa câu hỏi ${f.code || `#${f.id}`}` : 'Thêm câu hỏi'),
      f.status === 'APPROVED' ? el('p', { class: 'note small' }, 'Sửa nội dung sẽ đưa câu hỏi về trạng thái chờ duyệt.') : null,
      el('label', {}, 'Câu hỏi chính', el('input', { name: 'question', value: f.question || '', required: true, maxlength: '500' })),
      el('label', {}, 'Cách hỏi khác', el('span', { class: 'hint' }, 'Mỗi dòng một cách hỏi'), el('textarea', { name: 'variants', rows: '3' }, (f.variants || []).join('\n'))),
      el('label', {}, 'Câu trả lời (trả nguyên văn cho thí sinh)', el('textarea', { name: 'answer', rows: '5', required: true }, f.answer || '')),
      el('div', { class: 'form-grid' },
        el('label', {}, 'Chủ đề', el('select', { name: 'topic' }, Object.entries(topics).map(([k, v]) => el('option', { value: k, selected: k === f.topic }, v)))),
        el('label', {}, 'Mã nguồn', el('span', { class: 'hint' }, 'Ví dụ: S01, S02'), el('input', { name: 'sourceCodes', value: (f.source_codes || []).join(', ') }))),
      el('div', { class: 'btn-row' }, el('button', { class: 'btn btn--primary', type: 'submit' }, 'Lưu'), el('button', { class: 'btn btn--ghost', type: 'button', 'data-action': 'faq-cancel' }, 'Hủy')));
  }

  let cache = [];
  admin.register({
    id: 'faq', title: 'Hỏi đáp (FAQ)', perm: 'FAQ_EDIT', events: ['FAQ_UPDATED'],
    async render(root) {
      topics = (await hht.meta()).topics;
      const status = root.dataset.faqStatus || '';
      const q = root.dataset.faqQ || '';
      const params = new URLSearchParams(Object.entries({ status, q }).filter(([, v]) => v));
      cache = (await apiClient.get(`/api/admin/faq?${params}`)).items;
      root.replaceChildren(
        el('form', { class: 'toolbar', 'data-action': 'faq-filter' },
          el('label', {}, 'Trạng thái', el('select', { name: 'status' }, [['', 'Tất cả'], ['DRAFT', 'Chờ duyệt'], ['APPROVED', 'Đã duyệt'], ['ARCHIVED', 'Lưu trữ']].map(([v, l]) => el('option', { value: v, selected: v === status }, l)))),
          el('label', {}, 'Tìm', el('input', { name: 'q', value: q })),
          el('button', { class: 'btn btn--sm', type: 'submit' }, 'Lọc'),
          el('button', { class: 'btn btn--sm btn--tag', type: 'button', 'data-action': 'faq-new' }, 'Thêm câu hỏi')),
        el('div', { id: 'faq-editor' }),
        admin.table(['Mã', 'Câu hỏi', 'Chủ đề', 'Độ tin cậy', 'Trạng thái', ''], cache.map((f) => el('tr', {},
          el('td', {}, f.code || `#${f.id}`),
          el('td', {}, el('strong', {}, f.question), el('div', { class: 'small muted' }, f.answer.slice(0, 180)), f.internal_note ? el('div', { class: 'small badge--wait' }, `Ghi chú nội bộ: ${f.internal_note}`) : null),
          el('td', { class: 'small' }, topics[f.topic] || f.topic),
          el('td', {}, f.reliability || '–'),
          el('td', {}, el('span', { class: `badge ${STATUS[f.status][1]}` }, STATUS[f.status][0])),
          el('td', {}, el('div', { class: 'btn-row' },
            f.status !== 'ARCHIVED' ? el('button', { class: 'btn btn--sm', 'data-action': 'faq-edit', 'data-id': f.id }, 'Sửa') : null,
            admin.can('FAQ_APPROVE') && f.status === 'DRAFT' ? el('button', { class: 'btn btn--sm btn--primary', 'data-action': 'faq-status', 'data-id': f.id, 'data-to': 'approve' }, 'Duyệt') : null,
            admin.can('FAQ_APPROVE') && f.status !== 'ARCHIVED' ? el('button', { class: 'btn btn--sm btn--ghost', 'data-action': 'faq-status', 'data-id': f.id, 'data-to': 'archive' }, 'Lưu trữ') : null,
            admin.can('FAQ_APPROVE') && f.status === 'ARCHIVED' ? el('button', { class: 'btn btn--sm btn--ghost', 'data-action': 'faq-status', 'data-id': f.id, 'data-to': 'restore' }, 'Khôi phục') : null)))), 'Không có câu hỏi'));
    },
  });

  actionDelegate.register({
    'faq-filter'(form) { const r = $('#tab'); r.dataset.faqStatus = form.status.value; r.dataset.faqQ = form.q.value; admin.reload(); },
    'faq-new': () => { $('#faq-editor').replaceChildren(editor()); },
    'faq-edit': (b) => { $('#faq-editor').replaceChildren(editor(cache.find((f) => String(f.id) === b.dataset.id))); $('#faq-editor').scrollIntoView({ behavior: 'smooth' }); },
    'faq-cancel': () => $('#faq-editor').replaceChildren(),
    async 'faq-save'(form) {
      const body = {
        question: form.question.value, answer: form.answer.value, topic: form.topic.value,
        variants: form.variants.value.split('\n').map((s) => s.trim()).filter(Boolean),
        sourceCodes: form.sourceCodes.value.split(/[,\s]+/).map((s) => s.trim().toUpperCase()).filter(Boolean),
      };
      try {
        if (form.dataset.id) await apiClient.put(`/api/admin/faq/${form.dataset.id}`, body); else await apiClient.post('/api/admin/faq', body);
        toast('Đã lưu', 'ok'); admin.reload();
      } catch (e) { toast(e.message, 'error'); }
    },
    'faq-status': (b) => apiClient.post(`/api/admin/faq/${b.dataset.id}/${b.dataset.to}`, {}).then(() => { toast('Đã cập nhật', 'ok'); admin.reload(); }).catch((e) => toast(e.message, 'error')),
  });
})();
