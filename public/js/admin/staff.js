(function () {
  'use strict';
  admin.register({
    id: 'staff', title: 'Tài khoản cán bộ', perm: 'STAFF_MANAGEMENT', events: [],
    async render(root) {
      const { items } = await apiClient.get('/api/admin/staff');
      root.replaceChildren(
        el('form', { class: 'panel form mb-m', 'data-action': 'staff-create' },
          el('h3', {}, 'Thêm tài khoản'),
          el('div', { class: 'form-grid' },
            el('label', {}, 'Tên đăng nhập', el('input', { name: 'username', required: true, placeholder: 'vd: nguyenvana' })),
            el('label', {}, 'Họ tên', el('input', { name: 'fullName', required: true })),
            el('label', {}, 'Email', el('input', { name: 'email', type: 'email' })),
            el('label', {}, 'Vai trò', el('select', { name: 'role' }, Object.entries(admin.ROLE_LABEL).map(([k, v]) => el('option', { value: k, selected: k === 'ADVISOR' }, v))))),
          el('button', { class: 'btn btn--primary', type: 'submit' }, 'Tạo tài khoản'),
          el('div', { id: 'staff-secret' })),
        admin.table(['Tài khoản', 'Vai trò', 'Trạng thái', ''], items.map((u) => el('tr', {},
          el('td', {}, el('strong', {}, u.full_name), el('div', { class: 'small muted' }, `${u.username}${u.email ? ` · ${u.email}` : ''}`)),
          el('td', {}, el('select', { 'data-role-of': u.id }, Object.entries(admin.ROLE_LABEL).map(([k, v]) => el('option', { value: k, selected: k === u.role }, v)))),
          el('td', {}, el('span', { class: `badge ${u.is_active ? 'badge--go' : 'badge--stop'}` }, u.is_active ? 'Hoạt động' : 'Đã khóa'), u.must_change_password ? el('div', { class: 'small muted' }, 'chưa đổi mật khẩu') : null),
          el('td', {}, el('div', { class: 'btn-row' },
            el('button', { class: 'btn btn--sm', 'data-action': 'staff-toggle', 'data-id': u.id, 'data-active': String(u.is_active) }, u.is_active ? 'Khóa' : 'Mở khóa'),
            el('button', { class: 'btn btn--sm btn--ghost', 'data-action': 'staff-reset', 'data-id': u.id }, 'Đặt lại mật khẩu')))))));
      $$('[data-role-of]', root).forEach((s) => s.addEventListener('change', () => apiClient.put(`/api/admin/staff/${s.dataset.roleOf}`, { role: s.value })
        .then(() => toast('Đã đổi vai trò', 'ok')).catch((e) => { toast(e.message, 'error'); admin.reload(); })));
    },
  });
  const showSecret = (title, pw) => $('#staff-secret').replaceChildren(el('p', { class: 'note' }, `${title}: `, el('strong', {}, pw), '. Mật khẩu chỉ hiện một lần, người dùng phải đổi khi đăng nhập.'));
  actionDelegate.register({
    async 'staff-create'(f) {
      try { const r = await apiClient.post('/api/admin/staff', Object.fromEntries(new FormData(f))); f.reset(); await admin.reload(); showSecret(`Mật khẩu tạm của ${r.user.username}`, r.temporaryPassword); } catch (e) { toast(e.message, 'error'); }
    },
    'staff-toggle': (b) => apiClient.put(`/api/admin/staff/${b.dataset.id}`, { isActive: b.dataset.active !== 'true' }).then(() => admin.reload()).catch((e) => toast(e.message, 'error')),
    async 'staff-reset'(b) {
      if (!(await confirmDialog('Đặt lại mật khẩu và đăng xuất mọi phiên của tài khoản này?', { okText: 'Đặt lại' }))) return;
      try { const r = await apiClient.post(`/api/admin/staff/${b.dataset.id}/reset-password`, {}); showSecret('Mật khẩu tạm mới', r.temporaryPassword); } catch (e) { toast(e.message, 'error'); }
    },
  });
})();
