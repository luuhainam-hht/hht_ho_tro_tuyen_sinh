(function () {
  'use strict';
  let majors = [];
  let items = [];
  const KIND = { DOC_CHECKLIST: 'Hồ sơ', SCHEDULE: 'Lịch', ONLINE_GUIDE_STEP: 'Hướng dẫn', CONTACT: 'Liên hệ' };

  admin.register({
    id: 'catalog', title: 'Ngành & cẩm nang', perm: 'KB_MANAGE', events: [],
    async render(root) {
      const meta = await hht.meta();
      [majors, items] = await Promise.all([
        apiClient.get('/api/admin/catalog/majors').then((r) => r.majors),
        apiClient.get('/api/admin/catalog/admission-items').then((r) => r.items),
      ]);
      const view = root.dataset.catalogView || 'majors';
      root.replaceChildren(
        el('div', { class: 'toolbar' },
          el('button', { class: `btn btn--sm ${view === 'majors' ? 'btn--primary' : ''}`, 'data-action': 'catalog-view', 'data-value': 'majors' }, `Ngành (${majors.length})`),
          el('button', { class: `btn btn--sm ${view === 'items' ? 'btn--primary' : ''}`, 'data-action': 'catalog-view', 'data-value': 'items' }, `Mục cẩm nang (${items.length})`)),
        el('div', { id: 'catalog-editor' }),
        view === 'majors'
          ? admin.table(['Ngành', 'Khoa', 'Hệ', 'Hỗ trợ', 'Hiển thị', ''], majors.map((m) => el('tr', {},
            el('td', {}, el('strong', {}, m.name), el('div', { class: 'small muted' }, m.occupation_code || m.code), m.internal_note ? el('div', { class: 'small' }, m.internal_note) : null),
            el('td', { class: 'small' }, m.faculty),
            el('td', { class: 'small' }, m.levels.map((l) => hht.LEVEL_SHORT[l]).join(', ') || '–'),
            el('td', { class: 'small' }, [m.state_support && `NN ${m.state_support}`, m.enterprise_support && `DN ${m.enterprise_support}`].filter(Boolean).join(' · ') || '–'),
            el('td', {}, el('span', { class: `badge ${m.is_active ? 'badge--go' : ''}` }, m.is_active ? 'Có' : 'Ẩn')),
            el('td', {}, el('button', { class: 'btn btn--sm', 'data-action': 'major-edit', 'data-code': m.code }, 'Sửa')))))
          : admin.table(['Loại', 'Đối tượng', 'Tiêu đề', 'Nội dung', ''], items.map((i) => el('tr', {},
            el('td', {}, KIND[i.kind]), el('td', { class: 'small' }, meta.audiences[i.audience] || i.audience),
            el('td', {}, i.title, i.is_mandatory === false ? el('div', { class: 'small muted' }, 'không bắt buộc') : null),
            el('td', { class: 'small' }, i.detail.slice(0, 200)),
            el('td', {}, el('button', { class: 'btn btn--sm', 'data-action': 'item-edit', 'data-id': i.id }, 'Sửa'))))));
      root._meta = meta;
    },
  });

  actionDelegate.register({
    'catalog-view': (b) => { $('#tab').dataset.catalogView = b.dataset.value; admin.reload(); },
    'major-edit'(b) {
      const m = majors.find((x) => x.code === b.dataset.code);
      const levels = $('#tab')._meta.levels;
      $('#catalog-editor').replaceChildren(el('form', { class: 'form panel mb-m', 'data-action': 'major-save', 'data-code': m.code },
        el('h3', {}, `Sửa ngành: ${m.name}`),
        el('div', { class: 'form-grid' },
          el('label', {}, 'Tên ngành', el('input', { name: 'name', value: m.name })),
          el('label', {}, 'Thời gian học', el('input', { name: 'duration', value: m.duration || '' })),
          el('label', {}, 'Nhà nước hỗ trợ', el('input', { name: 'stateSupport', value: m.state_support || '' })),
          el('label', {}, 'Doanh nghiệp hỗ trợ', el('input', { name: 'enterpriseSupport', value: m.enterprise_support || '' }))),
        el('fieldset', {}, el('legend', {}, 'Hệ tuyển sinh'), el('div', { class: 'btn-row' }, Object.entries(levels).map(([k, v]) => el('label', { class: 'check' }, el('input', { type: 'checkbox', name: 'levels', value: k, checked: m.levels.includes(k) }), v)))),
        el('label', {}, 'Mô tả', el('textarea', { name: 'description', rows: '3' }, m.description || '')),
        el('label', { class: 'check' }, el('input', { type: 'checkbox', name: 'supportNeedsVerify', checked: m.support_needs_verify }), 'Mức hỗ trợ học phí cần xác minh'),
        el('label', { class: 'check' }, el('input', { type: 'checkbox', name: 'isActive', checked: m.is_active }), 'Hiển thị trên cẩm nang'),
        el('label', {}, 'Ghi chú nội bộ', el('input', { name: 'internalNote', value: m.internal_note || '' })),
        el('div', { class: 'btn-row' }, el('button', { class: 'btn btn--primary', type: 'submit' }, 'Lưu'), el('button', { class: 'btn btn--ghost', type: 'button', 'data-action': 'catalog-cancel' }, 'Hủy'))));
      $('#catalog-editor').scrollIntoView({ behavior: 'smooth' });
    },
    async 'major-save'(f) {
      const fd = new FormData(f);
      try {
        await apiClient.put(`/api/admin/catalog/majors/${encodeURIComponent(f.dataset.code)}`, {
          name: fd.get('name'), duration: fd.get('duration'), stateSupport: fd.get('stateSupport'), enterpriseSupport: fd.get('enterpriseSupport'),
          description: fd.get('description'), internalNote: fd.get('internalNote'), levels: fd.getAll('levels'),
          supportNeedsVerify: fd.get('supportNeedsVerify') === 'on', isActive: fd.get('isActive') === 'on',
        });
        toast('Đã lưu ngành', 'ok'); admin.reload();
      } catch (e) { toast(e.message, 'error'); }
    },
    'item-edit'(b) {
      const i = items.find((x) => String(x.id) === b.dataset.id);
      $('#catalog-editor').replaceChildren(el('form', { class: 'form panel mb-m', 'data-action': 'item-save', 'data-id': i.id },
        el('h3', {}, `Sửa mục: ${i.title}`),
        el('label', {}, 'Tiêu đề', el('input', { name: 'title', value: i.title })),
        el('label', {}, 'Nội dung', el('textarea', { name: 'detail', rows: '3' }, i.detail)),
        i.kind === 'SCHEDULE' ? el('div', { class: 'form-grid' },
          el('label', {}, 'Từ ngày', el('input', { type: 'date', name: 'dateFrom', value: i.date_from || '' })),
          el('label', {}, 'Đến ngày', el('input', { type: 'date', name: 'dateTo', value: i.date_to || '' }))) : null,
        i.kind === 'DOC_CHECKLIST' ? el('label', { class: 'check' }, el('input', { type: 'checkbox', name: 'isMandatory', checked: i.is_mandatory }), 'Bắt buộc') : null,
        el('label', { class: 'check' }, el('input', { type: 'checkbox', name: 'isActive', checked: i.is_active }), 'Hiển thị'),
        el('div', { class: 'btn-row' }, el('button', { class: 'btn btn--primary', type: 'submit' }, 'Lưu'), el('button', { class: 'btn btn--ghost', type: 'button', 'data-action': 'catalog-cancel' }, 'Hủy'))));
    },
    async 'item-save'(f) {
      const fd = new FormData(f);
      const body = { title: fd.get('title'), detail: fd.get('detail'), isActive: fd.get('isActive') === 'on' };
      if (f.querySelector('[name="isMandatory"]')) body.isMandatory = fd.get('isMandatory') === 'on';
      if (fd.get('dateFrom')) body.dateFrom = fd.get('dateFrom');
      if (fd.get('dateTo')) body.dateTo = fd.get('dateTo');
      try { await apiClient.put(`/api/admin/catalog/admission-items/${f.dataset.id}`, body); toast('Đã lưu', 'ok'); admin.reload(); } catch (e) { toast(e.message, 'error'); }
    },
    'catalog-cancel': () => $('#catalog-editor').replaceChildren(),
  });
})();
