(function () {
  'use strict';
  admin.register({
    id: 'system', title: 'Cấu hình & nhật ký', perm: 'CONFIG', events: ['CONFIG_UPDATED', 'JOB_UPDATED'],
    async render(root) {
      const [{ configs, llmKeys }, audit, jobs] = await Promise.all([
        apiClient.get('/api/admin/system/configs'), apiClient.get('/api/admin/system/audit?limit=50'), apiClient.get('/api/admin/system/jobs'),
      ]);
      root.replaceChildren(
        el('p', { class: 'small muted' }, `Khóa Gemini: ${llmKeys.length ? llmKeys.map((k) => `${k.label}${k.coolingDownMs ? ` (nghỉ ${Math.ceil(k.coolingDownMs / 1000)}s)` : ''}`).join(', ') : 'chưa cấu hình – trợ lý dùng FAQ và trích dẫn văn bản'}. Thay đổi tham số có hiệu lực ngay trên mọi máy chủ.`),
        admin.table(['Tham số', 'Mô tả', 'Giá trị', ''], configs.map((c) => el('tr', {},
          el('td', {}, el('code', {}, c.key), c.isPublic ? el('div', { class: 'small muted' }, 'hiển thị công khai') : null),
          el('td', { class: 'small' }, c.description, c.minBound !== null || c.maxBound !== null ? el('div', { class: 'muted' }, `Giới hạn: ${c.minBound ?? '…'} – ${c.maxBound ?? '…'}`) : null),
          el('td', {}, c.value.length > 60 ? el('textarea', { rows: '3', 'data-key': c.key }, c.value) : el('input', { value: c.value, 'data-key': c.key })),
          el('td', {}, el('button', { class: 'btn btn--sm', 'data-action': 'config-save', 'data-key': c.key }, 'Lưu'))))),
        el('div', { class: 'grid-2 mt-m' },
          el('section', {}, el('h3', {}, 'Nhật ký thao tác'), admin.table(['Thời gian', 'Người', 'Thao tác', 'Đối tượng'], audit.items.map((a) => el('tr', {},
            el('td', { class: 'small' }, admin.dt(a.created_at)), el('td', { class: 'small' }, a.actor_name || 'Hệ thống'), el('td', { class: 'small' }, a.action), el('td', { class: 'small' }, `${a.target_type} ${a.target_id || ''}`))))),
          el('section', {}, el('h3', {}, 'Việc nền'), admin.table(['#', 'Loại', 'Trạng thái', 'Lỗi'], jobs.items.map((j) => el('tr', {},
            el('td', {}, String(j.id)), el('td', { class: 'small' }, j.type), el('td', {}, el('span', { class: `badge ${j.status === 'DONE' ? 'badge--go' : j.status === 'FAILED' ? 'badge--stop' : 'badge--wait'}` }, j.status)), el('td', { class: 'small' }, j.last_error || '')))))));
    },
  });
  actionDelegate.register({
    'config-save'(b) {
      const input = $(`[data-key="${b.dataset.key}"]:not(button)`);
      return apiClient.put(`/api/admin/system/configs/${b.dataset.key}`, { value: input.value })
        .then((r) => { input.value = r.config.value; toast(`Đã lưu ${b.dataset.key}`, 'ok'); })
        .catch((e) => toast(e.message, 'error'));
    },
  });
})();
