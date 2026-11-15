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
  let policy = { passwordMinLength: 10 };
  const refreshers = new Map();

  // Lựa chọn có sẵn cho một số tham số (máy chủ vẫn kiểm tra lại).
  const ENUMS = {
    AI_TONE: { THAN_THIEN: 'Thân thiện, gần gũi', TRANG_TRONG: 'Lịch sự, trang trọng', NGAN_GON: 'Ngắn gọn, đi thẳng vào ý' },
  };
  const MODEL_SUGGESTIONS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro', 'gemini-2.0-flash'];
  const LONG_TEXT = new Set(['AI_EXTRA_INSTRUCTIONS', 'CHAT_GREETING', 'SUBMISSION_ADDRESS']);

  /** Một dòng cài đặt: tên + mô tả bên trái, ô nhập bên phải. data-config/data-initial để biết ô nào đã sửa. */
  function configField(c) {
    const id = `cfg-${c.key}`;
    const common = { id, 'data-config': c.key, 'data-initial': c.value };
    let control;
    if (c.valueType === 'BOOL') {
      const box = el('input', { ...common, type: 'checkbox', checked: c.value === 'true' });
      control = el('label', { class: 'check' }, box, el('span', {}, 'Bật'));
    } else if (ENUMS[c.key]) {
      control = el('select', common, Object.entries(ENUMS[c.key]).map(([k, v]) => el('option', { value: k, selected: k === c.value }, v)));
    } else if (c.valueType === 'INT' || c.valueType === 'NUMBER') {
      control = el('input', { ...common, type: 'number', value: c.value, inputmode: c.valueType === 'INT' ? 'numeric' : 'decimal', min: c.minBound ?? null, max: c.maxBound ?? null });
      control.step = c.valueType === 'INT' ? '1' : '0.01';
    } else if (LONG_TEXT.has(c.key) || c.valueType === 'JSON' || c.value.length > 60) {
      control = el('textarea', { ...common, rows: c.key === 'AI_EXTRA_INSTRUCTIONS' ? '5' : '3', maxlength: '2000' }, c.value);
    } else {
      control = el('input', { ...common, value: c.value });
      if (/MODEL$/.test(c.key)) control.setAttribute('list', 'model-suggestions');
    }
    const range = c.minBound !== null || c.maxBound !== null ? ` Giới hạn ${c.minBound ?? '…'} – ${c.maxBound ?? '…'}.` : '';
    return el('div', { class: 'setting-row' },
      el('div', {}, el('label', { for: id, class: 'setting-name' }, c.label || c.key), el('p', { class: 'hint mb-0' }, `${c.description}.${range}`.replace('..', '.'))),
      el('div', {}, control));
  }

  const fieldValue = (inp) => (inp.type === 'checkbox' ? String(inp.checked) : inp.value.trim());

  /** Lưu các ô đã sửa trong một vùng; dừng ở ô lỗi đầu tiên để người dùng sửa. */
  async function saveConfigs(root) {
    const changed = $$('[data-config]', root).filter((i) => fieldValue(i) !== i.dataset.initial);
    if (!changed.length) { toast('Chưa có thay đổi nào', 'info'); return 0; }
    for (const inp of changed) {
      try {
        const r = await apiClient.put(`/api/admin/system/configs/${inp.dataset.config}`, { value: fieldValue(inp) });
        inp.dataset.initial = r.config.value;
        if (inp.type !== 'checkbox') inp.value = r.config.value;
      } catch (e) {
        inp.focus();
        toast(e.message, 'error');
        return -1;
      }
    }
    toast(`Đã lưu ${changed.length} thay đổi`, 'ok');
    return changed.length;
  }

  /** Ô mật khẩu có nút Hiện/Ẩn, tùy chọn nút Tạo ngẫu nhiên, và dòng gợi ý độ mạnh. */
  function passwordInput(name, { autocomplete = 'new-password', generate = false, label = 'Mật khẩu', required = true, username = '', strength = true } = {}) {
    const input = el('input', { name, type: 'password', autocomplete, required });
    if (strength) input.setAttribute('minlength', String(policy.passwordMinLength));
    const status = el('span', { class: 'hint' });
    const check = () => {
      const v = input.value;
      const miss = [];
      if (v.length < policy.passwordMinLength) miss.push(`ít nhất ${policy.passwordMinLength} ký tự`);
      if (!/[A-Za-zÀ-ỹ]/.test(v)) miss.push('có chữ');
      if (!/\d/.test(v)) miss.push('có số');
      if (username && v.toLowerCase().includes(username.toLowerCase())) miss.push('không chứa tên đăng nhập');
      status.textContent = !v ? `Ít nhất ${policy.passwordMinLength} ký tự, có cả chữ và số.` : miss.length ? `Cần: ${miss.join(', ')}.` : 'Mật khẩu hợp lệ.';
      status.dataset.ok = String(Boolean(v) && !miss.length);
    };
    if (strength) { input.addEventListener('input', check); check(); }
    return el('label', {}, label,
      el('span', { class: 'pw-field' }, input,
        el('button', { type: 'button', class: 'btn btn--sm', 'data-action': 'pw-toggle' }, 'Hiện'),
        generate ? el('button', { type: 'button', class: 'btn btn--sm', 'data-action': 'pw-generate' }, 'Tạo ngẫu nhiên') : null),
      status);
  }

  /** Mật khẩu ngẫu nhiên phía trình duyệt: bỏ ký tự dễ nhầm, luôn có chữ hoa, chữ thường và số. */
  function randomPassword() {
    const len = Math.max(12, policy.passwordMinLength);
    const pools = ['ABCDEFGHJKMNPQRSTUVWXYZ', 'abcdefghjkmnpqrstuvwxyz', '23456789'];
    const all = pools.join('');
    const rnd = (n) => { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] % n; };
    const chars = pools.map((p) => p[rnd(p.length)]);
    while (chars.length < len) chars.push(all[rnd(all.length)]);
    for (let i = chars.length - 1; i > 0; i -= 1) { const j = rnd(i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
    return chars.join('');
  }

  /** Hộp thoại có form. Trả về Object các trường khi bấm nút chính, null khi đóng. */
  function formDialog({ title, intro = null, fields, okText = 'Lưu', onSubmit }) {
    return new Promise((resolve) => {
      const form = el('form', { class: 'form', method: 'dialog' },
        el('h2', { class: 'mb-0' }, title), intro ? el('p', { class: 'small muted mb-0' }, intro) : null, fields,
        el('div', { class: 'btn-row' }, el('button', { class: 'btn btn--primary', type: 'submit', value: 'ok' }, okText), el('button', { class: 'btn', type: 'button', value: 'cancel' }, 'Hủy')));
      const dlg = el('dialog', { class: 'dialog-form' }, form);
      let result = null;
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const data = Object.fromEntries(new FormData(form));
        $$('input[type=checkbox]', form).forEach((c) => { if (c.name) data[c.name] = c.checked; });
        const btn = $('button[type=submit]', form);
        btn.disabled = true;
        try {
          const out = onSubmit ? await onSubmit(data, form) : data;
          if (out === false) return;
          result = out ?? data;
          dlg.close();
        } catch (err) { toast(err.message, 'error'); } finally { btn.disabled = false; }
      });
      $('button[value=cancel]', form).addEventListener('click', () => dlg.close());
      dlg.addEventListener('close', () => { resolve(result); dlg.remove(); });
      document.body.append(dlg);
      dlg.showModal();
      $('input, textarea, select', form)?.focus();
    });
  }

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
    reload() { return current ? admin.show(current.id) : Promise.resolve(); },
    setBadge(id, n) { const b = $(`#admin-nav [data-tab="${id}"] .badge`); if (b) { b.textContent = n ? String(n) : ''; b.classList.toggle('hidden', !n); } },
    onRefresh(id, fn) { refreshers.set(id, fn); },
    table(headers, rows, empty = 'Chưa có dữ liệu') {
      return el('div', { class: 'table-wrap' }, el('table', { class: 'table' },
        el('thead', {}, el('tr', {}, headers.map((h) => el('th', {}, h)))),
        el('tbody', {}, rows.length ? rows : el('tr', {}, el('td', { colspan: String(headers.length), class: 'empty' }, empty)))));
    },
    dt: (iso) => (iso ? new Date(iso).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'short', timeStyle: 'short' }) : ''),
    policy: () => policy,
    configField, saveConfigs, passwordInput, randomPassword, formDialog, MODEL_SUGGESTIONS,
    /** Tải danh sách tham số một lần cho các tab cài đặt. */
    async configs() { return (await apiClient.get('/api/admin/system/configs')).configs; },
  };

  /** Gợi ý tên mô hình cho mọi ô *_MODEL (thẻ datalist dùng chung). */
  document.body.append(el('datalist', { id: 'model-suggestions' }, MODEL_SUGGESTIONS.map((m) => el('option', { value: m }))));

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
      const { user: u, policy: p } = await apiClient.get('/api/auth/me');
      if (p) policy = p;
      if (u.mustChangePassword) { showForcedChange(); return; }
      await startApp(u);
    } catch {
      apiClient.setToken(null);
      $('#login').classList.remove('hidden');
    }
  }

  /** Màn hình bắt buộc đổi mật khẩu (tài khoản mới / vừa được đặt lại). */
  async function showForcedChange() {
    try { const me = await apiClient.get('/api/auth/me'); if (me.policy) policy = me.policy; } catch { /* dùng chính sách mặc định */ }
    $('#login').classList.add('hidden');
    $('#cp-hint').textContent = `Tài khoản mới hoặc vừa được đặt lại mật khẩu cần đổi mật khẩu trước khi sử dụng. Mật khẩu ít nhất ${policy.passwordMinLength} ký tự, có cả chữ và số.`;
    $('#cp-new').replaceChildren(passwordInput('newPassword', { label: 'Mật khẩu mới' }));
    $('#change-password').classList.remove('hidden');
  }

  async function changeOwnPassword() {
    await formDialog({
      title: 'Đổi mật khẩu của tôi',
      intro: 'Sau khi đổi, các thiết bị khác đang đăng nhập tài khoản này sẽ bị đăng xuất.',
      fields: [
        el('label', {}, 'Mật khẩu hiện tại', el('input', { name: 'currentPassword', type: 'password', autocomplete: 'current-password', required: true })),
        passwordInput('newPassword', { label: 'Mật khẩu mới', username: user?.username }),
        el('label', {}, 'Nhập lại mật khẩu mới', el('input', { name: 'confirm', type: 'password', autocomplete: 'new-password', required: true })),
      ],
      okText: 'Đổi mật khẩu',
      async onSubmit(d) {
        if (d.newPassword !== d.confirm) { toast('Hai lần nhập mật khẩu mới không khớp', 'error'); return false; }
        await apiClient.post('/api/auth/change-password', { currentPassword: d.currentPassword, newPassword: d.newPassword });
        toast('Đã đổi mật khẩu', 'ok');
        return true;
      },
    });
  }

  actionDelegate.register({
    async login(form) {
      try {
        const res = await apiClient.post('/api/auth/login', Object.fromEntries(new FormData(form)));
        apiClient.setToken(res.token);
        if (res.user.mustChangePassword) { await showForcedChange(); return; }
        const me = await apiClient.get('/api/auth/me').catch(() => null);
        if (me?.policy) policy = me.policy;
        await startApp(res.user);
      } catch (e) { toast(e.message, 'error'); }
    },
    async 'change-password'(form) {
      const d = Object.fromEntries(new FormData(form));
      if (d.newPassword !== d.confirm) { toast('Hai lần nhập mật khẩu mới không khớp', 'error'); return; }
      try {
        await apiClient.post('/api/auth/change-password', { currentPassword: d.currentPassword, newPassword: d.newPassword });
        toast('Đã đổi mật khẩu', 'ok');
        const { user: u } = await apiClient.get('/api/auth/me');
        await startApp(u);
      } catch (e) { toast(e.message, 'error'); }
    },
    'my-password': changeOwnPassword,
    'pw-toggle'(b) {
      const input = b.parentElement.querySelector('input');
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      b.textContent = show ? 'Ẩn' : 'Hiện';
    },
    'pw-generate'(b) {
      const input = b.parentElement.querySelector('input');
      input.value = randomPassword();
      input.type = 'text';
      b.parentElement.querySelector('[data-action="pw-toggle"]').textContent = 'Ẩn';
      input.dispatchEvent(new Event('input'));
      const form = b.closest('form');
      const confirm = form?.querySelector('input[name="confirm"]');
      if (confirm) confirm.value = input.value;
    },
    async copy(b) {
      try { await navigator.clipboard.writeText(b.dataset.text); toast('Đã chép vào bộ nhớ tạm', 'ok'); } catch { toast('Trình duyệt không cho chép, hãy bôi đen và chép thủ công', 'error'); }
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
