/**
 * Tab Tài khoản cán bộ: tạo tài khoản (mật khẩu tạm hoặc tự đặt), đổi vai trò, đặt mật khẩu,
 * cấp mật khẩu tạm, gỡ tạm khóa, đăng xuất mọi thiết bị, khóa tài khoản; chính sách mật khẩu & đăng nhập.
 */
(function () {
  'use strict';
  const SECURITY_KEYS = ['PASSWORD_MIN_LENGTH', 'SESSION_TTL_HOURS', 'LOGIN_MAX_FAILED_ATTEMPTS', 'LOGIN_LOCK_MINUTES'];
  /** Bảng có menu thả xuống: không cắt menu ở màn hình rộng (màn hẹp vẫn cuộn ngang). */
  const withMenus = (t) => { t.classList.add('table-wrap--menus'); return t; };
  const isLocked = (u) => u.locked_until && new Date(u.locked_until) > new Date();

  function statusCell(u, self) {
    const out = [];
    if (!u.is_active) out.push(el('span', { class: 'badge badge--stop' }, 'Đã khóa tài khoản'));
    else if (isLocked(u)) out.push(el('span', { class: 'badge badge--wait' }, `Tạm khóa đến ${admin.dt(u.locked_until)}`));
    else out.push(el('span', { class: 'badge badge--go' }, 'Hoạt động'));
    if (u.must_change_password) out.push(el('div', { class: 'small muted' }, 'Chưa đổi mật khẩu được cấp'));
    else if (u.failed_login_attempts) out.push(el('div', { class: 'small muted' }, `Nhập sai ${u.failed_login_attempts} lần gần đây`));
    // Khóa / mở khóa ngay tại cột Trạng thái (không phải mở menu Thao tác).
    if (!self) {
      const btn = (action, label, cls = '', extra = {}) => el('button', { type: 'button', class: `link-btn ${cls}`, 'data-action': action, 'data-id': u.id, 'data-name': u.full_name, 'data-username': u.username, ...extra }, label);
      out.push(el('div', { class: 'status-actions' },
        btn('staff-toggle', u.is_active ? 'Khóa' : 'Mở khóa', u.is_active ? 'danger' : '', { 'data-active': String(u.is_active) }),
        isLocked(u) && u.is_active ? btn('staff-unlock', 'Gỡ tạm khóa') : null,
        btn('staff-delete', 'Xóa', 'danger')));
    }
    return out;
  }

  function actionsMenu(u, self) {
    const item = (action, label, extra = {}) => el('button', { type: 'button', 'data-action': action, 'data-id': u.id, 'data-username': u.username, 'data-name': u.full_name, ...extra }, label);
    return el('details', { class: 'actions-menu' },
      el('summary', { class: 'btn btn--sm' }, 'Thao tác'),
      el('div', {},
        self
          ? item('my-password', 'Đổi mật khẩu của tôi')
          : [
            item('staff-set-password', 'Đặt mật khẩu mới…'),
            item('staff-reset', 'Cấp mật khẩu tạm ngẫu nhiên'),
            isLocked(u) ? item('staff-unlock', 'Gỡ tạm khóa đăng nhập') : null,
            item('staff-logout-all', 'Đăng xuất khỏi mọi thiết bị'),
            el('hr'),
            item('staff-toggle', u.is_active ? 'Khóa tài khoản' : 'Mở khóa tài khoản', { class: u.is_active ? 'danger' : null, 'data-active': String(u.is_active) }),
            item('staff-delete', 'Xóa (đóng) tài khoản…', { class: 'danger' }),
          ]));
  }

  function createForm() {
    return el('form', { class: 'panel form mb-m', 'data-action': 'staff-create' },
      el('h3', { class: 'mb-0' }, 'Thêm tài khoản'),
      el('div', { class: 'form-grid' },
        el('label', {}, 'Tên đăng nhập', el('input', { name: 'username', required: true, placeholder: 'vd: nguyenvana', autocomplete: 'off' }), el('span', { class: 'hint' }, 'Chữ thường không dấu, số, dấu chấm hoặc gạch.')),
        el('label', {}, 'Họ tên', el('input', { name: 'fullName', required: true })),
        el('label', {}, 'Email', el('input', { name: 'email', type: 'email' })),
        el('label', {}, 'Vai trò', el('select', { name: 'role', 'data-role-select': '' }, Object.entries(admin.ROLE_LABEL).map(([k, v]) => el('option', { value: k, selected: k === 'ADVISOR' }, v))),
          el('span', { class: 'hint' }, 'Phòng Tuyển sinh: quản lý hồ sơ, đợt nhận hồ sơ, ngành mọi khoa, hỏi đáp, liên hệ. Cán bộ Khoa: chỉ ngành của khoa mình.')),
        el('label', { class: 'hidden', id: 'staff-faculty' }, 'Khoa phụ trách', el('input', { name: 'faculty', list: 'faculty-options', placeholder: 'Chọn hoặc gõ tên khoa' }))),
      el('fieldset', {},
        el('legend', {}, 'Mật khẩu ban đầu'),
        el('label', { class: 'check' }, el('input', { type: 'radio', name: 'pwMode', value: 'temp', checked: true }), el('span', {}, 'Hệ thống tạo mật khẩu tạm (hiện một lần sau khi tạo)')),
        el('label', { class: 'check' }, el('input', { type: 'radio', name: 'pwMode', value: 'own' }), el('span', {}, 'Tự đặt mật khẩu')),
        el('div', { class: 'form hidden mt-xs', id: 'staff-own-pw' },
          admin.passwordInput('password', { label: 'Mật khẩu', generate: true, required: false }),
          el('label', { class: 'check' }, el('input', { type: 'checkbox', name: 'mustChangePassword', checked: true }), el('span', {}, 'Yêu cầu đổi mật khẩu ở lần đăng nhập đầu')))),
      el('div', { class: 'btn-row' }, el('button', { class: 'btn btn--primary', type: 'submit' }, 'Tạo tài khoản')),
      el('div', { id: 'staff-secret' }));
  }

  /** Xuất Excel: danh sách tài khoản, hoặc cấp mật khẩu tạm mới cho tài khoản đã tích chọn rồi xuất kèm mật khẩu. */
  function exportPanel() {
    return el('section', { class: 'panel mb-m' },
      el('h3', { class: 'mb-0' }, 'Xuất tài khoản ra Excel'),
      el('p', { class: 'hint' }, 'Mật khẩu được mã hóa một chiều nên không ai xem lại được mật khẩu cũ. Muốn có tệp kèm mật khẩu: tích chọn cán bộ trong bảng dưới, bấm "Cấp mật khẩu tạm & xuất Excel" – hệ thống tạo mật khẩu tạm mới, cán bộ phải đổi ở lần đăng nhập đầu.'),
      el('div', { class: 'btn-row' },
        el('button', { class: 'btn btn--sm', type: 'button', 'data-action': 'staff-export-list' }, 'Xuất danh sách tài khoản'),
        el('button', { class: 'btn btn--sm btn--primary', type: 'button', 'data-action': 'staff-export-passwords' }, 'Cấp mật khẩu tạm & xuất Excel'),
        el('span', { class: 'small muted', id: 'export-count' }, 'Chưa chọn tài khoản nào')));
  }

  async function downloadExport(body, fallbackName) {
    const res = await apiClient.raw('POST', '/api/admin/staff/export.xlsx', body);
    const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '')?.[1] || fallbackName;
    const url = URL.createObjectURL(await res.blob());
    const a = el('a', { href: url, download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
  const selectedIds = () => [...document.querySelectorAll('[data-export-id]:checked')].map((x) => Number(x.dataset.exportId));
  document.addEventListener('change', (e) => {
    if (e.target.matches?.('[data-export-all]')) document.querySelectorAll('[data-export-id]').forEach((x) => { x.checked = e.target.checked; });
    if (e.target.matches?.('[data-export-all], [data-export-id]')) {
      const n = selectedIds().length; const out = document.getElementById('export-count');
      if (out) out.textContent = n ? `Đã chọn ${n} tài khoản` : 'Chưa chọn tài khoản nào';
    }
  });

  admin.register({
    id: 'staff', title: 'Tài khoản cán bộ', perm: 'STAFF_MANAGEMENT', events: [],
    async render(root) {
      const [{ items }, configs, overview] = await Promise.all([apiClient.get('/api/admin/staff'), admin.configs(), apiClient.get('/api/handbook/overview').catch(() => ({ faculties: [] }))]);
      faculties = overview.faculties.map((f) => f.faculty);
      const me = admin.user();
      const byKey = new Map(configs.map((c) => [c.key, c]));
      root.replaceChildren(
        createForm(),
        exportPanel(),
        withMenus(admin.table([el('input', { type: 'checkbox', 'data-export-all': '', 'aria-label': 'Chọn tất cả tài khoản để cấp mật khẩu tạm' }), 'Tài khoản', 'Vai trò', 'Trạng thái', 'Đăng nhập gần nhất', 'Đổi mật khẩu', ''], items.map((u) => {
          const self = Number(u.id) === Number(me.id);
          return el('tr', {},
            el('td', {}, self ? null : el('input', { type: 'checkbox', 'data-export-id': u.id, 'aria-label': `Chọn ${u.full_name}` })),
            el('td', {}, el('strong', {}, u.full_name, self ? ' (bạn)' : ''), el('div', { class: 'small muted' }, `${u.username}${u.email ? ` · ${u.email}` : ''}`)),
            el('td', {}, el('select', { 'data-role-of': u.id, 'data-name': u.full_name, 'data-faculty': u.faculty || '', 'aria-label': `Vai trò của ${u.full_name}`, disabled: self }, Object.entries(admin.ROLE_LABEL).map(([k, v]) => el('option', { value: k, selected: k === u.role }, v))),
              u.role === 'FACULTY' ? el('div', { class: 'small mt-xs' }, 'Khoa: ', el('strong', {}, u.faculty || '—'), ' ', el('button', { type: 'button', class: 'link-btn', 'data-action': 'staff-faculty', 'data-id': u.id, 'data-name': u.full_name, 'data-faculty': u.faculty || '' }, 'Đổi khoa')) : null),
            el('td', {}, statusCell(u, self)),
            el('td', { class: 'small' }, u.last_login_at ? admin.dt(u.last_login_at) : el('span', { class: 'muted' }, 'Chưa đăng nhập')),
            el('td', { class: 'small' }, u.password_changed_at ? admin.dt(u.password_changed_at) : el('span', { class: 'muted' }, '—')),
            el('td', {}, actionsMenu(u, self)));
        }))),
        el('section', { class: 'panel settings mt-m' },
          el('h3', { class: 'mb-0' }, 'Chính sách mật khẩu và đăng nhập'),
          el('p', { class: 'hint' }, 'Áp dụng cho mọi tài khoản cán bộ. Độ dài mật khẩu mới chỉ áp dụng khi đặt hoặc đổi mật khẩu; thời hạn phiên áp dụng từ lần đăng nhập tiếp theo.'),
          el('form', { class: 'settings-form', 'data-action': 'staff-policy-save' },
            SECURITY_KEYS.filter((k) => byKey.has(k)).map((k) => admin.configField(byKey.get(k))),
            el('div', { class: 'btn-row' }, el('button', { class: 'btn btn--primary', type: 'submit' }, 'Lưu chính sách')))));

      root.append(el('datalist', { id: 'faculty-options' }, faculties.map((f) => el('option', { value: f }))));
      $$('[data-role-of]', root).forEach((s) => s.addEventListener('change', async () => {
        const body = { role: s.value };
        if (s.value === 'FACULTY') {
          const faculty = await askFaculty(s.dataset.name, s.dataset.faculty);
          if (!faculty) { admin.reload(); return; }
          body.faculty = faculty;
        }
        apiClient.put(`/api/admin/staff/${s.dataset.roleOf}`, body)
          .then(() => { toast('Đã đổi vai trò. Tài khoản đó cần đăng nhập lại.', 'ok'); admin.reload(); }).catch((e) => { toast(e.message, 'error'); admin.reload(); });
      }));
      const roleSel = $('[data-role-select]', root);
      roleSel.addEventListener('change', () => { $('#staff-faculty').classList.toggle('hidden', roleSel.value !== 'FACULTY'); $('#staff-faculty input').required = roleSel.value === 'FACULTY'; });
      $$('input[name="pwMode"]', root).forEach((r) => r.addEventListener('change', () => {
        const own = $('input[name="pwMode"]:checked', root).value === 'own';
        $('#staff-own-pw').classList.toggle('hidden', !own);
        $('#staff-own-pw input[name="password"]').required = own;
      }));
    },
  });

  let faculties = [];
  /** Hộp chọn khoa cho Cán bộ Khoa. Trả tên khoa hoặc null khi hủy. */
  async function askFaculty(name, current = '') {
    const r = await admin.formDialog({
      title: `Khoa phụ trách của ${name}`,
      intro: 'Cán bộ Khoa chỉ xem, sửa và thêm ngành thuộc khoa này.',
      fields: [el('label', {}, 'Khoa', el('select', { name: 'faculty', required: true },
        el('option', { value: '' }, '— Chọn khoa —'),
        [...new Set([...faculties, current].filter(Boolean))].map((f) => el('option', { value: f, selected: f === current }, f))))],
      okText: 'Lưu khoa',
    });
    return r?.faculty || null;
  }

  // Đóng menu thao tác khi bấm ra ngoài hoặc đã chọn một thao tác (đăng ký một lần cho cả trang).
  document.addEventListener('click', (e) => $$('.actions-menu[open]').forEach((d) => { if (!d.contains(e.target) || e.target.closest('[data-action]')) d.open = false; }));

  function showSecret(title, pw) {
    const box = $('#staff-secret');
    box.replaceChildren(el('div', { class: 'note secret-box' },
      el('span', {}, `${title}:`), el('code', {}, pw),
      el('button', { type: 'button', class: 'btn btn--sm', 'data-action': 'copy', 'data-text': pw }, 'Chép'),
      el('span', { class: 'small' }, 'Mật khẩu chỉ hiện một lần. Gửi trực tiếp cho người dùng (không gửi qua nhóm chat chung).')));
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  actionDelegate.register({
    async 'staff-create'(f) {
      const d = Object.fromEntries(new FormData(f));
      const own = d.pwMode === 'own';
      const body = { username: d.username, fullName: d.fullName, email: d.email || null, role: d.role, faculty: d.role === 'FACULTY' ? d.faculty : null };
      if (own) Object.assign(body, { password: d.password, mustChangePassword: f.elements.mustChangePassword.checked });
      try {
        const r = await apiClient.post('/api/admin/staff', body);
        await admin.reload();
        if (r.temporaryPassword) showSecret(`Mật khẩu tạm của ${r.user.username}`, r.temporaryPassword);
        else toast(`Đã tạo tài khoản ${r.user.username} với mật khẩu bạn đặt`, 'ok');
      } catch (e) { toast(e.message, 'error'); }
    },
    async 'staff-set-password'(b) {
      const r = await admin.formDialog({
        title: `Đặt mật khẩu cho ${b.dataset.name}`,
        intro: `Tài khoản ${b.dataset.username} sẽ bị đăng xuất khỏi mọi thiết bị và gỡ tạm khóa (nếu có).`,
        fields: [
          admin.passwordInput('newPassword', { label: 'Mật khẩu mới', generate: true, username: b.dataset.username }),
          el('label', {}, 'Nhập lại mật khẩu mới', el('input', { name: 'confirm', type: 'password', autocomplete: 'new-password', required: true })),
          el('label', { class: 'check' }, el('input', { type: 'checkbox', name: 'requireChange', checked: true }), el('span', {}, 'Yêu cầu người dùng đổi mật khẩu ở lần đăng nhập tiếp theo')),
        ],
        okText: 'Đặt mật khẩu',
        async onSubmit(d) {
          if (d.newPassword !== d.confirm) { toast('Hai lần nhập mật khẩu không khớp', 'error'); return false; }
          await apiClient.post(`/api/admin/staff/${b.dataset.id}/set-password`, { newPassword: d.newPassword, requireChange: d.requireChange });
          return d;
        },
      });
      if (!r) return;
      await admin.reload();
      showSecret(`Mật khẩu mới của ${b.dataset.username}`, r.newPassword);
    },
    async 'staff-reset'(b) {
      if (!(await confirmDialog(`Cấp mật khẩu tạm mới cho ${b.dataset.name}? Mật khẩu cũ hết hiệu lực và tài khoản bị đăng xuất khỏi mọi thiết bị.`, { okText: 'Cấp mật khẩu tạm' }))) return;
      try { const r = await apiClient.post(`/api/admin/staff/${b.dataset.id}/reset-password`, {}); await admin.reload(); showSecret(`Mật khẩu tạm mới của ${b.dataset.username}`, r.temporaryPassword); } catch (e) { toast(e.message, 'error'); }
    },
    async 'staff-unlock'(b) {
      try { await apiClient.post(`/api/admin/staff/${b.dataset.id}/unlock`, {}); toast(`${b.dataset.name} đăng nhập lại được ngay`, 'ok'); admin.reload(); } catch (e) { toast(e.message, 'error'); }
    },
    async 'staff-logout-all'(b) {
      if (!(await confirmDialog(`Đăng xuất ${b.dataset.name} khỏi mọi thiết bị? Dùng khi nghi lộ mật khẩu hoặc quên đăng xuất ở máy dùng chung.`, { okText: 'Đăng xuất' }))) return;
      try { const r = await apiClient.post(`/api/admin/staff/${b.dataset.id}/logout-all`, {}); toast(`Đã đăng xuất ${r.sessions} phiên`, 'ok'); } catch (e) { toast(e.message, 'error'); }
    },
    async 'staff-toggle'(b) {
      const lock = b.dataset.active === 'true';
      if (lock && !(await confirmDialog(`Khóa tài khoản ${b.dataset.name}? Người này không đăng nhập được cho đến khi mở khóa.`, { okText: 'Khóa tài khoản', danger: true }))) return;
      try {
        await apiClient.put(`/api/admin/staff/${b.dataset.id}`, { isActive: !lock });
        toast(lock ? `Đã khóa tài khoản ${b.dataset.name} và đăng xuất khỏi mọi thiết bị` : `Đã mở khóa tài khoản ${b.dataset.name}`, 'ok');
        admin.reload();
      } catch (e) { toast(e.message, 'error'); }
    },
    async 'staff-delete'(b) {
      if (!(await confirmDialog(`Xóa vĩnh viễn tài khoản ${b.dataset.name} (${b.dataset.username})? Không thể hoàn tác. FAQ, tài liệu, nhật ký do người này tạo vẫn được giữ. Nếu chỉ muốn tạm ngưng, hãy chọn "Khóa".`, { okText: 'Xóa tài khoản', danger: true }))) return;
      try { await apiClient.del(`/api/admin/staff/${b.dataset.id}`); toast(`Đã xóa tài khoản ${b.dataset.username}`, 'ok'); admin.reload(); } catch (e) { toast(e.message, 'error'); }
    },
    'staff-policy-save': (form) => admin.saveConfigs(form),
    async 'staff-export-list'() {
      try { await downloadExport({ mode: 'LIST' }, 'tai-khoan-can-bo.xlsx'); toast('Đã xuất danh sách tài khoản', 'ok'); } catch (e) { toast(e.message, 'error'); }
    },
    async 'staff-export-passwords'() {
      const ids = selectedIds();
      if (!ids.length) { toast('Tích chọn ít nhất một cán bộ trong bảng (ô đầu mỗi dòng)', 'error'); return; }
      if (!(await confirmDialog(`Cấp mật khẩu tạm MỚI cho ${ids.length} tài khoản và xuất ra Excel? Mật khẩu cũ của họ hết hiệu lực ngay, họ bị đăng xuất và phải đổi mật khẩu ở lần đăng nhập đầu. Tệp Excel là tài liệu mật: phát riêng từng người rồi xóa tệp.`, { okText: 'Cấp & xuất Excel', danger: true }))) return;
      try {
        await downloadExport({ mode: 'NEW_PASSWORDS', ids, confirm: true }, 'mat-khau-tam-can-bo.xlsx');
        toast(`Đã cấp mật khẩu tạm cho ${ids.length} tài khoản và tải tệp Excel`, 'ok');
        admin.reload();
      } catch (e) { toast(e.message, 'error'); }
    },
    async 'staff-faculty'(b) {
      const faculty = await askFaculty(b.dataset.name, b.dataset.faculty);
      if (!faculty) return;
      try { await apiClient.put(`/api/admin/staff/${b.dataset.id}`, { faculty }); toast('Đã đổi khoa. Tài khoản đó cần đăng nhập lại.', 'ok'); admin.reload(); } catch (e) { toast(e.message, 'error'); }
    },
  });
})();
