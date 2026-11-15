/**
 * Khung Admin: đăng nhập, phân quyền hiển thị tab (theo PERMISSION_GROUPS phía server – server vẫn
 * kiểm tra lại mọi thao tác), điều hướng tab, realtime qua WebSocket đã xác thực.
 */
(function () {
  'use strict';
  const PERMS = {
    KB_VIEW: ['SUPER_ADMIN', 'LEADER', 'ADVISOR'], KB_MANAGE: ['SUPER_ADMIN', 'ADVISOR'], KB_PUBLISH: ['SUPER_ADMIN', 'LEADER'], FAQ_EDIT: ['SUPER_ADMIN', 'LEADER', 'ADVISOR'],
    FAQ_APPROVE: ['SUPER_ADMIN', 'LEADER'], HANDOFF: ['SUPER_ADMIN', 'ADVISOR'], ANALYTICS: ['SUPER_ADMIN', 'LEADER', 'ADVISOR'],
    APPOINTMENT_MANAGE: ['SUPER_ADMIN', 'LEADER', 'ADVISOR'], CONFIG: ['SUPER_ADMIN'], STAFF_MANAGEMENT: ['SUPER_ADMIN'],
  };
  const ROLE_LABEL = { SUPER_ADMIN: 'Quản trị hệ thống', LEADER: 'Lãnh đạo', ADVISOR: 'Cán bộ tư vấn' };
  const tabs = [];
  let current = null;
  let user = null;
  const refreshers = new Map();

  const admin = {
    user: () => user,
    can: (perm) => Boolean(user && PERMS[perm]?.includes(user.role)),
    ROLE_LABEL,
    /** Mỗi tab: { id, title, perm, render(root), events: [WS types làm tab tự tải lại] } */
    register(tab) { tabs.push(tab); },
    async show(id) {
      const tab = tabs.find((t) => t.id === id && admin.can(t.perm)) || tabs.find((t) => admin.can(t.perm));
      if (!tab) return;
      current = tab;
      try { sessionStorage.setItem('hht.adminTab', tab.id); } catch { /* bỏ qua */ }
      $$('#admin-nav button').forEach((b) => (b.dataset.tab === tab.id ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current')));
      $('#tab-title').textContent = tab.title;
      const root = $('#tab');
      root.replaceChildren(el('p', { class: 'muted' }, 'Đang tải…'));
      try { await tab.render(root); } catch (e) { root.replaceChildren(el('p', { class: 'note note--stop' }, e.message)); }
    },
    reload() { if (current) admin.show(current.id); },
    setBadge(id, n) { const b = $(`#admin-nav [data-tab="${id}"] .badge`); if (b) { b.textContent = n ? String(n) : ''; b.classList.toggle('hidden', !n); } },
    onRefresh(id, fn) { refreshers.set(id, fn); },
    table(headers, rows, empty = 'Chưa có dữ liệu') {
      return el('div', { class: 'table-wrap' }, el('table', { class: 'table' },
        el('thead', {}, el('tr', {}, headers.map((h) => el('th', {}, h)))),
        el('tbody', {}, rows.length ? rows : el('tr', {}, el('td', { colspan: String(headers.length), class: 'empty' }, empty)))));
    },
    dt: (iso) => (iso ? new Date(iso).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'short', timeStyle: 'short' }) : ''),
  };

  async function startApp(u) {
    user = u;
    $('#login').classList.add('hidden');
    $('#change-password').classList.add('hidden');
    $('#app').classList.remove('hidden');
    $('#who').textContent = `${u.fullName} · ${ROLE_LABEL[u.role]}`;
    $('#admin-nav').replaceChildren(...tabs.filter((t) => admin.can(t.perm)).map((t) => el('button', { type: 'button', 'data-action': 'tab', 'data-tab': t.id }, t.title, el('span', { class: 'badge hidden' }))));
    let saved = null;
    try { saved = sessionStorage.getItem('hht.adminTab'); } catch { /* */ }
    await admin.show(saved || tabs[0].id);
    const ws = createWsClient({ getToken: () => apiClient.getToken() });
    ws.on('STATUS', ({ connected }) => { $('#ws-status').textContent = connected ? 'Trực tuyến' : 'Mất kết nối'; $('#ws-status').className = `badge ${connected ? 'badge--go' : 'badge--stop'}`; });
    ws.on('*', (payload, type) => {
      for (const fn of refreshers.values()) fn(type, payload);
      if (current?.events?.includes(type)) {
        clearTimeout(admin._t);
        admin._t = setTimeout(() => admin.reload(), 600); // gom nhiều sự kiện liên tiếp thành một lần tải lại
      }
    });
  }

  async function boot() {
    if (!apiClient.getToken()) { $('#login').classList.remove('hidden'); return; }
    try {
      const { user: u } = await apiClient.get('/api/auth/me');
      if (u.mustChangePassword) { $('#change-password').classList.remove('hidden'); return; }
      await startApp(u);
    } catch {
      apiClient.setToken(null);
      $('#login').classList.remove('hidden');
    }
  }

  actionDelegate.register({
    async login(form) {
      try {
        const res = await apiClient.post('/api/auth/login', Object.fromEntries(new FormData(form)));
        apiClient.setToken(res.token);
        if (res.user.mustChangePassword) { $('#login').classList.add('hidden'); $('#change-password').classList.remove('hidden'); return; }
        await startApp(res.user);
      } catch (e) { toast(e.message, 'error'); }
    },
    async 'change-password'(form) {
      try {
        await apiClient.post('/api/auth/change-password', Object.fromEntries(new FormData(form)));
        toast('Đã đổi mật khẩu', 'ok');
        const { user: u } = await apiClient.get('/api/auth/me');
        await startApp(u);
      } catch (e) { toast(e.message, 'error'); }
    },
    async logout() {
      await apiClient.post('/api/auth/logout').catch(() => {});
      apiClient.setToken(null);
      location.reload();
    },
    tab: (b) => admin.show(b.dataset.tab),
  });

  window.admin = admin;
  window.adminBoot = boot;
})();
