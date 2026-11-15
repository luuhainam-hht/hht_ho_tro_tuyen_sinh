/**
 * Tab Cấu hình & nhật ký: tham số chung theo nhóm (AI và bảo mật đăng nhập nằm ở tab riêng),
 * nhật ký thao tác, việc nền.
 */
(function () {
  'use strict';
  const GROUPS = [
    ['GENERAL', 'Chung'],
    ['CONTACT', 'Liên hệ, khung chat và kênh'],
    ['RECOMMEND', 'Gợi ý ngành'],
    ['APPOINTMENT', 'Đặt lịch nộp hồ sơ'],
  ];
  const ACTION_LABEL = {
    CONFIG_UPDATE: 'Sửa tham số', STAFF_CREATE: 'Tạo tài khoản', STAFF_UPDATE: 'Sửa tài khoản', STAFF_RESET_PASSWORD: 'Cấp mật khẩu tạm',
    STAFF_SET_PASSWORD: 'Đặt mật khẩu', STAFF_UNLOCK: 'Gỡ tạm khóa', STAFF_LOGOUT_ALL: 'Đăng xuất mọi thiết bị', PASSWORD_CHANGE: 'Tự đổi mật khẩu',
    AI_KEY_ADD: 'Thêm khóa AI', AI_KEY_UPDATE: 'Sửa khóa AI', AI_KEY_DELETE: 'Xóa khóa AI', AI_CACHE_CLEAR: 'Xóa bộ nhớ đệm AI',
  };

  admin.register({
    id: 'system', title: 'Cấu hình & nhật ký', perm: 'CONFIG', events: ['JOB_UPDATED'],
    async render(root) {
      const [configs, audit, jobs] = await Promise.all([
        admin.configs(), apiClient.get('/api/admin/system/audit?limit=50'), apiClient.get('/api/admin/system/jobs'),
      ]);
      root.replaceChildren(
        el('p', { class: 'small muted' }, 'Thay đổi có hiệu lực ngay trên mọi máy chủ. Tham số AI nằm ở tab "Cài đặt AI"; chính sách mật khẩu ở tab "Tài khoản cán bộ".'),
        GROUPS.map(([g, title]) => {
          const rows = configs.filter((c) => c.group === g);
          if (!rows.length) return null;
          return el('section', { class: 'panel settings' },
            el('h3', { class: 'mb-0' }, title),
            el('form', { class: 'settings-form mt-s', 'data-action': 'config-save-group' }, rows.map(admin.configField),
              el('div', { class: 'btn-row' }, el('button', { class: 'btn btn--primary', type: 'submit' }, 'Lưu thay đổi'))));
        }),
        el('div', { class: 'grid-2 mt-m' },
          el('section', {}, el('h3', {}, 'Nhật ký thao tác'), admin.table(['Thời gian', 'Người', 'Thao tác', 'Đối tượng'], audit.items.map((a) => el('tr', {},
            el('td', { class: 'small' }, admin.dt(a.created_at)), el('td', { class: 'small' }, a.actor_name || 'Hệ thống'),
            el('td', { class: 'small' }, ACTION_LABEL[a.action] || a.action), el('td', { class: 'small' }, `${a.target_type} ${a.target_id || ''}`))))),
          el('section', {}, el('h3', {}, 'Việc nền'), admin.table(['#', 'Loại', 'Trạng thái', 'Lỗi'], jobs.items.map((j) => el('tr', {},
            el('td', {}, String(j.id)), el('td', { class: 'small' }, j.type), el('td', {}, el('span', { class: `badge ${j.status === 'DONE' ? 'badge--go' : j.status === 'FAILED' ? 'badge--stop' : 'badge--wait'}` }, j.status)), el('td', { class: 'small' }, j.last_error || '')))))));
    },
  });
  actionDelegate.register({ 'config-save-group': (form) => admin.saveConfigs(form) });
})();
