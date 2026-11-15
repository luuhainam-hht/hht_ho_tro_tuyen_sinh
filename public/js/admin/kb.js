(function () {
  'use strict';
  const STATUS = { DRAFT: ['Nháp', ''], PROCESSING: ['Đang xử lý', 'badge--wait'], READY: ['Sẵn sàng công bố', 'badge--wait'], PUBLISHED: ['Đang dùng', 'badge--go'], ARCHIVED: ['Lưu trữ', ''], FAILED: ['Lỗi', 'badge--stop'] };

  admin.register({
    id: 'kb', title: 'Kho tri thức', perm: 'KB_VIEW', events: ['KB_DOCUMENT_UPDATED', 'JOB_UPDATED'],
    async render(root) {
      const { documents } = await apiClient.get('/api/admin/kb');
      const published = documents.filter((d) => d.status === 'PUBLISHED');
      root.replaceChildren(
        el('p', { class: 'small muted' }, 'Phần hỏi đáp chỉ dùng các tài liệu "Đang dùng" của năm tuyển sinh hiện hành. Công bố hoặc lưu trữ tài liệu thì câu trả lời được cập nhật ngay.'),
        admin.can('KB_MANAGE') ? el('details', { class: 'panel mb-m' }, el('summary', {}, el('strong', {}, 'Tải lên văn bản tuyển sinh (PDF, DOCX, TXT)')),
          el('form', { class: 'form mt-s', 'data-action': 'kb-upload' },
            el('div', { class: 'form-grid' },
              el('label', {}, 'Tên văn bản', el('input', { name: 'title', required: true, maxlength: '300' })),
              el('label', {}, 'Số/ký hiệu', el('input', { name: 'docNo', maxlength: '100' })),
              el('label', {}, 'Ngày ban hành', el('input', { name: 'issuedDate', type: 'date' })),
              el('label', {}, 'Đường dẫn gốc', el('input', { name: 'sourceUrl', type: 'url', placeholder: 'https://hht.edu.vn/…' })),
              el('label', {}, 'Thay thế văn bản', el('select', { name: 'replacesDocumentId' }, el('option', { value: '' }, 'Không thay thế'), published.map((d) => el('option', { value: d.id }, d.title.slice(0, 80))))),
              el('label', {}, 'Tệp', el('input', { name: 'file', type: 'file', accept: '.pdf,.docx,.txt,.md', required: true }))),
            el('button', { class: 'btn btn--primary', type: 'submit' }, 'Tải lên và xử lý'))) : null,
        admin.can('CONFIG') ? el('div', { class: 'btn-row mb-m' }, el('button', { class: 'btn btn--sm', 'data-action': 'kb-reembed' }, 'Tạo vector cho đoạn còn thiếu')) : null,
        admin.table(['Văn bản', 'Nguồn', 'Đoạn', 'Trạng thái', 'Thao tác'], documents.map((d) => el('tr', {},
          el('td', {}, d.source_url ? el('a', { href: d.source_url, target: '_blank', rel: 'noopener' }, d.title) : d.title,
            el('div', { class: 'small muted' }, [d.source_code, d.doc_no, d.file_name].filter(Boolean).join(' · ')),
            d.error ? el('div', { class: 'small badge--stop' }, d.error) : null),
          el('td', { class: 'small' }, d.published_by_name || d.uploaded_by_name || 'Bộ dữ liệu khởi tạo'),
          el('td', {}, String(d.chunk_count)),
          el('td', {}, el('span', { class: `badge ${STATUS[d.status][1]}` }, STATUS[d.status][0])),
          el('td', {}, el('div', { class: 'btn-row' },
            el('button', { class: 'btn btn--sm', 'data-action': 'kb-view', 'data-id': d.id }, 'Xem đoạn'),
            admin.can('KB_PUBLISH') && (d.status === 'READY' || (d.status === 'ARCHIVED' && d.chunk_count > 0)) ? el('button', { class: 'btn btn--sm btn--primary', 'data-action': 'kb-publish', 'data-id': d.id }, 'Công bố') : null,
            admin.can('KB_PUBLISH') && d.status === 'PUBLISHED' ? el('button', { class: 'btn btn--sm btn--ghost', 'data-action': 'kb-archive', 'data-id': d.id }, 'Lưu trữ') : null,
            admin.can('KB_MANAGE') && ['FAILED', 'READY', 'DRAFT'].includes(d.status) && d.file_name ? el('button', { class: 'btn btn--sm btn--ghost', 'data-action': 'kb-reprocess', 'data-id': d.id }, 'Xử lý lại') : null)))), 'Chưa có tài liệu'),
        el('div', { id: 'kb-detail' }));
    },
  });

  actionDelegate.register({
    async 'kb-upload'(form) {
      const fd = new FormData(form);
      for (const [k, v] of [...fd.entries()]) if (v === '') fd.delete(k);
      try { await apiClient.raw('POST', '/api/admin/kb', fd); toast('Đã tải lên, hệ thống đang xử lý', 'ok'); admin.reload(); } catch (e) { toast(e.message, 'error'); }
    },
    async 'kb-view'(b) {
      const { document: d, chunks } = await apiClient.get(`/api/admin/kb/${b.dataset.id}`);
      $('#kb-detail').replaceChildren(el('section', { class: 'panel mt-m' }, el('h3', {}, `${d.title} – ${chunks.length} đoạn`),
        chunks.map((c) => el('div', { class: 'mt-s' }, el('div', { class: 'small muted' }, `#${c.chunk_index} · ${c.heading_path || 'không đề mục'} · ~${c.token_count} token${c.page_from ? ` · tr. ${c.page_from}` : ''}${c.has_embedding ? ' · có vector' : ''}`), el('pre', { class: 'chunk' }, c.content)))));
      $('#kb-detail').scrollIntoView({ behavior: 'smooth' });
    },
    async 'kb-publish'(b) {
      if (!(await confirmDialog('Công bố văn bản này? Trợ lý sẽ dùng nội dung để trả lời thí sinh ngay.', { okText: 'Công bố' }))) return;
      apiClient.post(`/api/admin/kb/${b.dataset.id}/publish`).then(() => { toast('Đã công bố', 'ok'); admin.reload(); }).catch((e) => toast(e.message, 'error'));
    },
    async 'kb-archive'(b) {
      if (!(await confirmDialog('Lưu trữ văn bản? Trợ lý sẽ không dùng văn bản này nữa.', { okText: 'Lưu trữ', danger: true }))) return;
      apiClient.post(`/api/admin/kb/${b.dataset.id}/archive`).then(() => { toast('Đã lưu trữ', 'ok'); admin.reload(); }).catch((e) => toast(e.message, 'error'));
    },
    'kb-reprocess': (b) => apiClient.post(`/api/admin/kb/${b.dataset.id}/reprocess`).then(() => toast('Đã xếp hàng xử lý lại', 'ok')).catch((e) => toast(e.message, 'error')),
    'kb-reembed': () => apiClient.post('/api/admin/kb/reembed', {}).then(() => toast('Đã xếp hàng tạo vector', 'ok')).catch((e) => toast(e.message, 'error')),
  });
})();
