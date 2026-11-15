(function () {
  'use strict';
  const { LEVEL_SHORT, params } = hht;
  const form = $('form[data-action="filter-majors"]');
  let timer;

  function supportCell(m) {
    const parts = [];
    if (m.state_support) parts.push(el('span', { class: 'badge badge--go' }, `Nhà nước ${m.state_support}`));
    if (m.enterprise_support) parts.push(el('span', { class: 'badge' }, `Doanh nghiệp ${m.enterprise_support}`));
    if (!parts.length) return el('span', { class: 'muted small' }, 'Theo quy định chung');
    if (m.support_needs_verify) parts.push(el('span', { class: 'small muted' }, ' cần xác minh'));
    return parts;
  }

  async function load() {
    const q = new URLSearchParams();
    for (const k of ['q', 'level', 'faculty', 'support']) if (form[k].value) q.set(k, form[k].value);
    history.replaceState(null, '', q.toString() ? `?${q}` : location.pathname);
    const { majors } = await apiClient.get(`/api/handbook/majors?${q}`);
    $('#major-count').textContent = `${majors.length} ngành phù hợp bộ lọc`;
    const rows = majors.map((m) => el('tr', {},
      el('td', {}, el('a', { href: `/nganh-chi-tiet.html?code=${encodeURIComponent(m.code)}` }, m.name),
        m.listed_in_latest_table ? null : el('div', { class: 'small muted' }, 'Không có trong bảng ngành 08/2026 – hỏi lại trường')),
      el('td', {}, m.faculty),
      el('td', {}, m.levels.length ? m.levels.map((l) => el('span', { class: 'lvl' }, LEVEL_SHORT[l])) : el('span', { class: 'muted small' }, 'Chưa công bố hệ')),
      el('td', {}, supportCell(m))));
    $('#major-rows').replaceChildren(...(rows.length ? rows : [el('tr', {}, el('td', { colspan: '4', class: 'empty' }, 'Không có ngành phù hợp. Thử bỏ bớt bộ lọc.'))]));
  }

  async function init() {
    const meta = await hht.meta();
    for (const [k, v] of Object.entries(meta.levels)) form.level.append(el('option', { value: k }, v));
    const { faculties } = await apiClient.get('/api/handbook/overview');
    for (const f of faculties) form.faculty.append(el('option', { value: f.faculty }, f.faculty));
    const p = params();
    for (const k of ['q', 'level', 'faculty', 'support']) if (p.get(k)) form[k].value = p.get(k);
    form.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => load().catch((e) => toast(e.message, 'error')), 250); });
    actionDelegate.register({ 'filter-majors': () => load() });
    await load();
  }
  init().catch((e) => toast(e.message, 'error'));
  void LEVEL_SHORT;
})();
