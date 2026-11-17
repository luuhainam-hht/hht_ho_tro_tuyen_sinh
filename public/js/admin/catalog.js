/**
 * Hai tab quản trị dữ liệu cẩm nang:
 *  - "Ngành học" (MAJOR_MANAGE): Phòng Tuyển sinh sửa mọi khoa; Cán bộ Khoa chỉ thấy/sửa/thêm ngành của khoa mình.
 *  - "Thông tin tuyển sinh" (ADMISSION_INFO): hồ sơ, đợt nhận hồ sơ, hướng dẫn đăng ký, liên hệ,
 *    giải thích hệ đào tạo / hỗ trợ học phí; kèm tham số liên hệ chung (CONTACT_CONFIG).
 * Máy chủ kiểm tra lại quyền và phạm vi khoa ở mọi thao tác.
 */
(function () {
  'use strict';
  const LEVEL_ORDER = [['SO_CAP', 'SC'], ['HE_9_PLUS', 'Hệ 9+'], ['TRUNG_CAP', 'TC'], ['CAO_DANG', 'CĐ']];
  const pct = (s) => { const m = /(\d{1,3})\s*%?/.exec(s || ''); return m ? Number(m[1]) : 0; };
  const vnd = (n) => (n ? `${Number(n).toLocaleString('vi-VN')} đ` : '–');

  // =====================================================================
  // Tab Ngành học
  // =====================================================================
  let majors = [];
  let majorScope = null;
  let allFaculties = [];

  function studentShare(m) { return Math.max(0, 100 - pct(m.state_support) - pct(m.enterprise_support)); }

  function majorEditor(m = null) {
    const creating = !m;
    const d = m || { levels: [], is_active: true, faculty: majorScope || '' };
    const facultyField = majorScope
      ? el('label', {}, 'Khoa', el('input', { name: 'faculty', value: majorScope, disabled: true }), el('span', { class: 'hint' }, 'Cán bộ Khoa chỉ quản lý ngành của khoa mình'))
      : el('label', {}, 'Khoa', el('input', { name: 'faculty', value: d.faculty || '', list: 'major-faculties', required: true }));
    const preview = el('p', { class: 'small muted mb-0', id: 'support-preview' });
    const form = el('form', { class: 'form panel mb-m', 'data-action': 'major-save', 'data-code': d.code || '' },
      el('h3', {}, creating ? 'Thêm ngành mới' : `Sửa ngành: ${d.name}`),
      el('div', { class: 'form-grid' },
        creating ? el('label', {}, 'Mã ngành', el('input', { name: 'code', required: true, placeholder: 'vd: 6480201', maxlength: '30' }), el('span', { class: 'hint' }, 'Mã nghề nhà nước hoặc mã nội bộ')) : null,
        el('label', {}, 'Tên ngành', el('input', { name: 'name', value: d.name || '', required: true, maxlength: '200' })),
        facultyField,
        el('label', {}, 'Thời gian học', el('input', { name: 'duration', value: d.duration || '', placeholder: 'vd: Cao đẳng khoảng 3 năm' }))),
      el('fieldset', {}, el('legend', {}, 'Hệ tuyển sinh'),
        el('div', { class: 'btn-row' }, LEVEL_ORDER.map(([k, short]) => el('label', { class: 'check' }, el('input', { type: 'checkbox', name: 'levels', value: k, checked: d.levels.includes(k) }), short === 'Hệ 9+' ? 'Hệ 9+ (THPT – Cao đẳng)' : `${short} – ${hht.LEVEL_SHORT[k]}`)))),
      el('fieldset', {}, el('legend', {}, 'Học phí và hỗ trợ học phí'),
        el('div', { class: 'admin-form-grid-3' },
          el('label', {}, 'Học phí thấp nhất (đ/tháng)', el('input', { name: 'tuitionPerMonthMin', type: 'number', min: '0', step: '1000', value: d.tuition_per_month_min ?? '' })),
          el('label', {}, 'Học phí cao nhất (đ/tháng)', el('input', { name: 'tuitionPerMonthMax', type: 'number', min: '0', step: '1000', value: d.tuition_per_month_max ?? '' })),
          el('span', {}),
          el('label', {}, 'Nhà nước hỗ trợ (%)', el('input', { name: 'stateSupport', value: d.state_support || '', placeholder: 'vd: 70%' })),
          el('label', {}, 'Doanh nghiệp hỗ trợ (%)', el('input', { name: 'enterpriseSupport', value: d.enterprise_support || '', placeholder: 'vd: 30%' })),
          el('div', {}, el('span', { class: 'setting-name' }, 'Sinh viên tự đóng'), preview)),
        el('label', { class: 'check mt-xs' }, el('input', { type: 'checkbox', name: 'supportNeedsVerify', checked: Boolean(d.support_needs_verify) }), 'Mức hỗ trợ học phí cần xác minh (hiện ghi chú "cần xác nhận")')),
      el('div', { class: 'form-grid' },
        el('label', {}, 'Chỉ tiêu hệ 9+ – Cơ sở 1', el('input', { name: 'quota9PlusCs1', type: 'number', min: '0', value: d.quota_9plus_cs1 ?? '' })),
        el('label', {}, 'Chỉ tiêu hệ 9+ – Cơ sở 2', el('input', { name: 'quota9PlusCs2', type: 'number', min: '0', value: d.quota_9plus_cs2 ?? '' }))),
      el('label', {}, 'Mô tả ngành', el('textarea', { name: 'description', rows: '3', maxlength: '3000' }, d.description || '')),
      el('label', { class: 'check' }, el('input', { type: 'checkbox', name: 'isActive', checked: d.is_active !== false }), 'Hiển thị trên trang Ngành học'),
      el('label', {}, 'Ghi chú nội bộ (không hiện cho thí sinh)', el('input', { name: 'internalNote', value: d.internal_note || '', maxlength: '1000' })),
      el('div', { class: 'btn-row' }, el('button', { class: 'btn btn--primary', type: 'submit' }, creating ? 'Thêm ngành' : 'Lưu'), el('button', { class: 'btn btn--ghost', type: 'button', 'data-action': 'catalog-cancel' }, 'Hủy')));
    const updatePreview = () => {
      const s = pct(form.stateSupport.value); const e = pct(form.enterpriseSupport.value);
      const sv = 100 - s - e;
      const lo = Number(form.tuitionPerMonthMin.value) || 0; const hi = Number(form.tuitionPerMonthMax.value) || lo;
      preview.textContent = sv < 0 ? 'Tổng hỗ trợ vượt 100% – kiểm tra lại' : `${sv}%${lo ? ` ≈ ${vnd(Math.round((lo * sv) / 100))}${hi !== lo ? ` – ${vnd(Math.round((hi * sv) / 100))}` : ''}/tháng` : ''}`;
    };
    form.addEventListener('input', updatePreview);
    updatePreview();
    return form;
  }

  admin.register({
    id: 'majors', title: 'Ngành học', perm: 'MAJOR_MANAGE', events: ['CATALOG_UPDATED'],
    async render(root) {
      const r = await apiClient.get('/api/admin/catalog/majors');
      majors = r.majors; majorScope = r.scopeFaculty; allFaculties = r.faculties;
      const fFaculty = root.dataset.majorFaculty || '';
      const fq = (root.dataset.majorQ || '').toLowerCase();
      const shown = majors.filter((m) => (!fFaculty || m.faculty === fFaculty) && (!fq || `${m.name} ${m.code}`.toLowerCase().includes(fq)));
      root.replaceChildren(
        majorScope ? el('p', { class: 'scope-note' }, 'Bạn đang quản lý ngành của ', el('strong', {}, `Khoa ${majorScope}`), '. Ngành mới thêm sẽ thuộc khoa này.') : null,
        el('form', { class: 'toolbar', 'data-action': 'major-filter' },
          majorScope ? null : el('label', {}, 'Khoa', el('select', { name: 'faculty' }, el('option', { value: '' }, 'Tất cả'), allFaculties.map((f) => el('option', { value: f, selected: f === fFaculty }, f)))),
          el('label', {}, 'Tìm', el('input', { name: 'q', value: root.dataset.majorQ || '' })),
          el('button', { class: 'btn btn--sm', type: 'submit' }, 'Lọc'),
          el('button', { class: 'btn btn--sm btn--tag', type: 'button', 'data-action': 'major-new' }, 'Thêm ngành')),
        el('datalist', { id: 'major-faculties' }, allFaculties.map((f) => el('option', { value: f }))),
        el('div', { id: 'catalog-editor' }),
        admin.table(['Ngành', 'Khoa', ...LEVEL_ORDER.map(([, s]) => s), 'Học phí/tháng', 'NN', 'DN', 'SV đóng', 'Hiển thị', ''], shown.map((m) => el('tr', {},
          el('td', {}, el('strong', {}, m.name), el('div', { class: 'small muted' }, m.occupation_code || m.code), m.internal_note ? el('div', { class: 'small' }, m.internal_note) : null),
          el('td', { class: 'small' }, m.faculty),
          LEVEL_ORDER.map(([k]) => el('td', { class: 'center' }, m.levels.includes(k) ? el('span', { class: 'tick' }, '✓') : el('span', { class: 'dash' }, '–'))),
          el('td', { class: 'small' }, m.tuition_per_month_min ? `${vnd(m.tuition_per_month_min)}${m.tuition_per_month_max && m.tuition_per_month_max !== m.tuition_per_month_min ? ` – ${vnd(m.tuition_per_month_max)}` : ''}` : '–'),
          el('td', {}, m.state_support || '–'),
          el('td', {}, m.enterprise_support || '–'),
          el('td', {}, el('strong', {}, `${studentShare(m)}%`), m.support_needs_verify && (m.state_support || m.enterprise_support) ? el('div', { class: 'tiny muted' }, 'cần xác minh') : null),
          el('td', {}, el('span', { class: `badge ${m.is_active ? 'badge--go' : ''}` }, m.is_active ? 'Có' : 'Ẩn')),
          el('td', {}, el('button', { class: 'btn btn--sm', 'data-action': 'major-edit', 'data-code': m.code }, 'Sửa')))), 'Chưa có ngành nào'));
    },
  });

  function majorBody(f) {
    const fd = new FormData(f);
    const num = (k) => (fd.get(k) === '' || fd.get(k) === null ? undefined : Number(fd.get(k)));
    const body = {
      name: fd.get('name'), duration: fd.get('duration') || undefined, description: fd.get('description') || undefined, internalNote: fd.get('internalNote') || undefined,
      levels: fd.getAll('levels'), stateSupport: fd.get('stateSupport'), enterpriseSupport: fd.get('enterpriseSupport'),
      tuitionPerMonthMin: num('tuitionPerMonthMin'), tuitionPerMonthMax: num('tuitionPerMonthMax'),
      quota9PlusCs1: num('quota9PlusCs1'), quota9PlusCs2: num('quota9PlusCs2'),
      supportNeedsVerify: fd.get('supportNeedsVerify') === 'on', isActive: fd.get('isActive') === 'on',
    };
    if (!majorScope) body.faculty = fd.get('faculty');
    if (fd.get('code')) body.code = fd.get('code');
    return body;
  }

  // =====================================================================
  // Tab Thông tin tuyển sinh
  // =====================================================================
  const VIEWS = [
    { id: 'DOC_CHECKLIST', label: 'Hồ sơ (trang Hồ sơ)' },
    { id: 'SCHEDULE', label: 'Đợt nhận hồ sơ / lịch' },
    { id: 'ONLINE_GUIDE_STEP', label: 'Hướng dẫn đăng ký' },
    { id: 'CONTACT', label: 'Liên hệ' },
    { id: 'INFO', label: 'Giải thích hệ & học phí' },
  ];
  const SCHEDULE_STATUS = { ONGOING: ['Đang diễn ra', 'badge--go'], UPCOMING: ['Sắp tới', 'badge--wait'], PAST: ['Đã qua', ''], UNKNOWN: ['Không có ngày', ''] };
  let items = [];
  let meta = null;

  function scheduleStatus(i) {
    if (!i.date_from && !i.date_to) return 'UNKNOWN';
    const today = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
    const from = i.date_from ? String(i.date_from).slice(0, 10) : null;
    const to = i.date_to ? String(i.date_to).slice(0, 10) : from;
    if (to && to < today) return 'PAST';
    if (from && from > today) return 'UPCOMING';
    return 'ONGOING';
  }

  const groupsOf = (kind) => [...new Set(items.filter((i) => i.kind === kind).map((i) => i.audience))];

  function itemEditor(kind, i = null) {
    const creating = !i;
    const d = i || { is_active: true, audience: kind === 'DOC_CHECKLIST' ? 'CHINH_QUY' : '', order_no: (Math.max(0, ...items.filter((x) => x.kind === kind).map((x) => x.order_no || 0)) + 1) };
    const isInfo = kind === 'LEVEL_INFO' || kind === 'SUPPORT_INFO';
    const fields = [];
    if (kind === 'DOC_CHECKLIST') {
      fields.push(el('div', { class: 'form-grid' },
        el('label', {}, 'Đối tượng', el('select', { name: 'audience' }, Object.entries(meta.audiences).map(([k, v]) => el('option', { value: k, selected: k === d.audience }, v)))),
        el('label', {}, 'Mã giấy tờ', el('input', { name: 'code', value: d.code || '', maxlength: '30', placeholder: 'vd: HS01' }))));
    } else if (kind === 'SCHEDULE' || kind === 'CONTACT') {
      fields.push(el('label', {}, kind === 'SCHEDULE' ? 'Nhóm đối tượng / hệ' : 'Nhóm liên hệ',
        el('input', { name: 'audience', value: d.audience === 'ALL' ? '' : d.audience, list: `groups-${kind}`, required: true, maxlength: '120', placeholder: kind === 'SCHEDULE' ? 'vd: CĐ, TC chính quy 2026–2027' : 'vd: Hotline tuyển sinh' }),
        el('datalist', { id: `groups-${kind}` }, groupsOf(kind).map((g) => el('option', { value: g })))));
    }
    if (isInfo) fields.push(el('p', { class: 'small muted' }, `Mã: ${d.code} – hiện khi thí sinh bấm cột tương ứng trên trang Ngành học và là tri thức của trợ lý.`));
    fields.push(
      el('label', {}, kind === 'SCHEDULE' ? 'Tên đợt' : 'Tiêu đề', el('input', { name: 'title', value: d.title || '', required: true, maxlength: '300', placeholder: kind === 'SCHEDULE' ? 'vd: Nhập học đợt 4' : '' })),
      el('label', {}, kind === 'SCHEDULE' ? 'Mô tả thời gian' : 'Nội dung', el('textarea', { name: 'detail', rows: isInfo ? '6' : '3', maxlength: '3000' }, d.detail || '')));
    if (kind === 'SCHEDULE') {
      fields.push(el('div', { class: 'form-grid' },
        el('label', {}, 'Từ ngày', el('input', { type: 'date', name: 'dateFrom', value: d.date_from ? String(d.date_from).slice(0, 10) : '' })),
        el('label', {}, 'Đến ngày', el('input', { type: 'date', name: 'dateTo', value: d.date_to ? String(d.date_to).slice(0, 10) : '' }))),
      el('p', { class: 'hint' }, 'Trạng thái "Đang diễn ra / Sắp tới / Đã qua" trên trang Lịch tuyển sinh tự tính theo ngày.'));
    }
    if (kind === 'DOC_CHECKLIST') {
      fields.push(el('div', { class: 'admin-form-grid-3' },
        el('label', {}, 'Loại bản', el('select', { name: 'copyType' }, el('option', { value: '' }, '—'), Object.entries(meta.copyTypes).map(([k, v]) => el('option', { value: k, selected: k === d.copy_type }, v)))),
        el('label', {}, 'Số lượng', el('input', { name: 'quantity', type: 'number', min: '1', max: '50', value: d.quantity ?? '' })),
        el('label', { class: 'check' }, el('input', { type: 'checkbox', name: 'isMandatory', checked: d.is_mandatory !== false }), 'Bắt buộc')));
    }
    fields.push(el('div', { class: 'form-grid' },
      el('label', {}, 'Thứ tự hiển thị', el('input', { name: 'orderNo', type: 'number', min: '0', value: d.order_no ?? 0 })),
      el('label', { class: 'check' }, el('input', { type: 'checkbox', name: 'isActive', checked: d.is_active !== false }), 'Hiển thị cho thí sinh')));
    return el('form', { class: 'form panel mb-m', 'data-action': 'item-save', 'data-id': d.id || '', 'data-kind': kind },
      el('h3', {}, creating ? `Thêm mục: ${VIEWS.find((v) => v.id === kind)?.label || kind}` : `Sửa: ${d.title}`),
      fields,
      el('div', { class: 'btn-row' }, el('button', { class: 'btn btn--primary', type: 'submit' }, creating ? 'Thêm' : 'Lưu'), el('button', { class: 'btn btn--ghost', type: 'button', 'data-action': 'catalog-cancel' }, 'Hủy')));
  }

  function rowActions(i, { canDelete = true } = {}) {
    return el('td', {}, el('div', { class: 'btn-row' },
      el('button', { class: 'btn btn--sm', 'data-action': 'item-edit', 'data-id': i.id }, 'Sửa'),
      canDelete ? el('button', { class: 'btn btn--sm btn--ghost', 'data-action': 'item-delete', 'data-id': i.id, 'data-title': i.title }, 'Xóa') : null));
  }
  const activeBadge = (i) => (i.is_active ? null : el('span', { class: 'badge' }, 'Đang ẩn'));

  function viewTable(view) {
    const list = view === 'INFO' ? items.filter((i) => i.kind === 'LEVEL_INFO' || i.kind === 'SUPPORT_INFO') : items.filter((i) => i.kind === view);
    if (view === 'DOC_CHECKLIST') {
      return admin.table(['Đối tượng', 'Giấy tờ', 'Loại bản', 'Bắt buộc', ''], list.map((i) => el('tr', {},
        el('td', { class: 'small' }, meta.audiences[i.audience] || i.audience),
        el('td', {}, el('strong', {}, i.title), ' ', activeBadge(i), el('div', { class: 'small muted' }, i.detail.slice(0, 200))),
        el('td', { class: 'small' }, meta.copyTypes[i.copy_type] || '–', i.quantity ? ` × ${i.quantity}` : ''),
        el('td', {}, i.is_mandatory === false ? 'Không' : 'Có'),
        rowActions(i))), 'Chưa có giấy tờ');
    }
    if (view === 'SCHEDULE') {
      return admin.table(['Nhóm', 'Đợt', 'Thời gian', 'Trạng thái', ''], list.map((i) => {
        const st = SCHEDULE_STATUS[scheduleStatus(i)];
        return el('tr', {},
          el('td', { class: 'small' }, i.audience),
          el('td', {}, el('strong', {}, i.title), ' ', activeBadge(i)),
          el('td', { class: 'small' }, i.detail, i.date_from || i.date_to ? el('div', { class: 'muted' }, `${hht.fmtDate(i.date_from)} → ${hht.fmtDate(i.date_to)}`) : null),
          el('td', {}, el('span', { class: `badge ${st[1]}` }, st[0])),
          rowActions(i));
      }), 'Chưa có đợt nào');
    }
    if (view === 'INFO') {
      return admin.table(['Loại', 'Mã', 'Tiêu đề', 'Nội dung', ''], list.map((i) => el('tr', {},
        el('td', { class: 'small' }, i.kind === 'LEVEL_INFO' ? 'Hệ đào tạo' : 'Hỗ trợ học phí'),
        el('td', { class: 'small' }, i.code),
        el('td', {}, el('strong', {}, i.title), ' ', activeBadge(i)),
        el('td', { class: 'small' }, i.detail.slice(0, 220)),
        rowActions(i, { canDelete: false }))), 'Chưa có nội dung');
    }
    return admin.table([view === 'CONTACT' ? 'Nhóm' : 'Bước', 'Tiêu đề', 'Nội dung', ''], list.map((i) => el('tr', {},
      el('td', { class: 'small' }, view === 'CONTACT' ? i.audience : String(i.order_no)),
      el('td', {}, el('strong', {}, i.title), ' ', activeBadge(i)),
      el('td', { class: 'small' }, i.detail.slice(0, 220)),
      rowActions(i))), 'Chưa có mục nào');
  }

  async function contactPanel() {
    if (!admin.can('CONTACT_CONFIG')) return null;
    const { configs } = await apiClient.get('/api/admin/catalog/contact-configs');
    return el('section', { class: 'panel settings mb-m' },
      el('h3', { class: 'mb-0' }, 'Thông tin liên hệ chung'),
      el('p', { class: 'hint' }, 'Hiện ở đầu trang, chân trang, trang Liên hệ và trong câu trả lời của trợ lý.'),
      el('form', { class: 'settings-form', 'data-action': 'contact-config-save' },
        configs.map((c) => admin.configField(c)),
        el('div', { class: 'btn-row' }, el('button', { class: 'btn btn--primary', type: 'submit' }, 'Lưu thông tin liên hệ'))));
  }

  admin.register({
    id: 'admission-info', title: 'Thông tin tuyển sinh', perm: 'ADMISSION_INFO', events: ['CATALOG_UPDATED'],
    async render(root) {
      meta = await hht.meta();
      items = (await apiClient.get('/api/admin/catalog/admission-items')).items;
      const view = root.dataset.infoView || 'SCHEDULE';
      root.replaceChildren(
        el('div', { class: 'subtabs', role: 'tablist' }, VIEWS.map((v) => el('button', {
          class: `btn btn--sm ${v.id === view ? 'btn--primary' : ''}`, role: 'tab', 'aria-selected': String(v.id === view), 'data-action': 'info-view', 'data-value': v.id,
        }, `${v.label} (${v.id === 'INFO' ? items.filter((i) => i.kind === 'LEVEL_INFO' || i.kind === 'SUPPORT_INFO').length : items.filter((i) => i.kind === v.id).length})`))),
        view === 'CONTACT' ? await contactPanel() : null,
        view === 'INFO' ? null : el('div', { class: 'toolbar' }, el('button', { class: 'btn btn--sm btn--tag', type: 'button', 'data-action': 'item-new', 'data-kind': view },
          view === 'SCHEDULE' ? 'Thêm đợt nhận hồ sơ' : view === 'DOC_CHECKLIST' ? 'Thêm giấy tờ' : view === 'CONTACT' ? 'Thêm liên hệ' : 'Thêm bước')),
        el('div', { id: 'catalog-editor' }),
        viewTable(view));
    },
  });

  function itemBody(f) {
    const fd = new FormData(f);
    const body = { title: fd.get('title'), detail: fd.get('detail') ?? '', isActive: fd.get('isActive') === 'on', orderNo: Number(fd.get('orderNo') || 0) };
    if (f.elements.audience) body.audience = fd.get('audience');
    if (f.elements.code) body.code = fd.get('code') || undefined;
    if (f.elements.isMandatory) body.isMandatory = fd.get('isMandatory') === 'on';
    if (f.elements.copyType) body.copyType = fd.get('copyType') || undefined;
    if (f.elements.quantity && fd.get('quantity')) body.quantity = Number(fd.get('quantity'));
    if (f.elements.dateFrom) { body.dateFrom = fd.get('dateFrom'); body.dateTo = fd.get('dateTo'); }
    return body;
  }

  const editorBox = () => $('#catalog-editor');
  const showEditor = (node) => { editorBox().replaceChildren(node); editorBox().scrollIntoView({ behavior: 'smooth', block: 'start' }); $('input:not([disabled]), textarea', node)?.focus(); };

  actionDelegate.register({
    // Ngành
    'major-filter'(f) { const r = $('#tab'); r.dataset.majorFaculty = f.faculty?.value || ''; r.dataset.majorQ = f.q.value; admin.reload(); },
    'major-new': () => showEditor(majorEditor()),
    'major-edit': (b) => showEditor(majorEditor(majors.find((x) => x.code === b.dataset.code))),
    async 'major-save'(f) {
      const body = majorBody(f);
      try {
        if (f.dataset.code) await apiClient.put(`/api/admin/catalog/majors/${encodeURIComponent(f.dataset.code)}`, body);
        else await apiClient.post('/api/admin/catalog/majors', body);
        toast(f.dataset.code ? 'Đã lưu ngành' : 'Đã thêm ngành', 'ok');
        admin.reload();
      } catch (e) { toast(e.message, 'error'); }
    },
    // Thông tin tuyển sinh
    'info-view': (b) => { $('#tab').dataset.infoView = b.dataset.value; admin.reload(); },
    'item-new': (b) => showEditor(itemEditor(b.dataset.kind)),
    'item-edit'(b) { const i = items.find((x) => String(x.id) === b.dataset.id); showEditor(itemEditor(i.kind, i)); },
    async 'item-save'(f) {
      const body = itemBody(f);
      try {
        if (f.dataset.id) await apiClient.put(`/api/admin/catalog/admission-items/${f.dataset.id}`, body);
        else await apiClient.post('/api/admin/catalog/admission-items', { ...body, kind: f.dataset.kind });
        toast('Đã lưu – trang công khai và trợ lý cập nhật ngay', 'ok');
        admin.reload();
      } catch (e) { toast(e.message, 'error'); }
    },
    async 'item-delete'(b) {
      if (!(await confirmDialog(`Xóa "${b.dataset.title}"? Nếu chỉ muốn tạm ẩn, hãy bấm Sửa và bỏ chọn "Hiển thị cho thí sinh".`, { okText: 'Xóa', danger: true }))) return;
      try { await apiClient.del(`/api/admin/catalog/admission-items/${b.dataset.id}`); toast('Đã xóa', 'ok'); admin.reload(); } catch (e) { toast(e.message, 'error'); }
    },
    async 'contact-config-save'(form) {
      const changed = $$('[data-config]', form).filter((i) => (i.type === 'checkbox' ? String(i.checked) : i.value.trim()) !== i.dataset.initial);
      if (!changed.length) { toast('Chưa có thay đổi nào', 'info'); return; }
      for (const inp of changed) {
        try {
          const r = await apiClient.put(`/api/admin/catalog/contact-configs/${inp.dataset.config}`, { value: inp.type === 'checkbox' ? String(inp.checked) : inp.value.trim() });
          inp.dataset.initial = r.config.value;
        } catch (e) { inp.focus(); toast(e.message, 'error'); return; }
      }
      toast(`Đã lưu ${changed.length} thay đổi`, 'ok');
    },
    'catalog-cancel': () => editorBox()?.replaceChildren(),
  });
})();
