(function () {
  'use strict';
  const { params } = hht;
  const form = $('form[data-action="filter-majors"]');
  let timer;

  /** Cột hệ tuyển sinh theo thứ tự yêu cầu: SC, Hệ 9+, TC, CĐ. */
  const LEVEL_COLS = [
    { code: 'SO_CAP', short: 'SC', long: 'Sơ cấp – ngắn hạn' },
    { code: 'HE_9_PLUS', short: 'Hệ 9+', long: 'THPT – Cao đẳng (tốt nghiệp THCS)' },
    { code: 'TRUNG_CAP', short: 'TC', long: 'Trung cấp' },
    { code: 'CAO_DANG', short: 'CĐ', long: 'Cao đẳng / CĐ liên thông' },
  ];
  const SUPPORT_COLS = [
    { code: 'NHA_NUOC', short: 'Nhà nước', long: 'Phần Nhà nước hỗ trợ' },
    { code: 'DOANH_NGHIEP', short: 'Doanh nghiệp', long: 'Phần doanh nghiệp hỗ trợ' },
    { code: 'SINH_VIEN', short: 'Sinh viên', long: 'Phần sinh viên tự đóng' },
  ];

  /** "70%" -> 70; chữ tự do không đọc được -> null (hiển thị nguyên văn). */
  const pct = (s) => { const m = /(\d{1,3})\s*%/.exec(s || ''); return m ? Math.min(100, Number(m[1])) : null; };
  const vnd = (n) => `${(Math.round(n / 1000) * 1000).toLocaleString('vi-VN')} đ`;

  /** Khoảng số tiền/tháng ứng với một tỉ lệ % trên học phí min–max của ngành. */
  function moneyRange(m, percent) {
    if (percent === null || !m.tuition_per_month_min) return null;
    const lo = (m.tuition_per_month_min * percent) / 100;
    const hi = ((m.tuition_per_month_max || m.tuition_per_month_min) * percent) / 100;
    if (percent === 0) return '0 đ';
    return lo === hi ? vnd(lo) : `${vnd(lo)} – ${vnd(hi)}`;
  }

  /** Ba ô Nhà nước / Doanh nghiệp / Sinh viên: % và số tiền/tháng. */
  function supportCells(m) {
    const state = m.state_support ? pct(m.state_support) : 0;
    const ent = m.enterprise_support ? pct(m.enterprise_support) : 0;
    const known = state !== null && ent !== null;
    const student = known ? Math.max(0, 100 - state - ent) : null;
    const cell = (col, raw, p, extraClass = '') => {
      const body = [];
      if (raw === null || raw === undefined || raw === '') body.push(el('span', { class: 'muted' }, '–'));
      else if (p === null) body.push(el('span', { class: 'small' }, raw));
      else {
        body.push(el('strong', { class: `pct ${extraClass}` }, `${p}%`));
        const money = moneyRange(m, p);
        if (money) body.push(el('span', { class: 'money' }, money));
      }
      return el('td', { class: 'num-cell', 'data-label': col.short }, body);
    };
    const verify = m.support_needs_verify && (m.state_support || m.enterprise_support);
    const studentCell = cell(SUPPORT_COLS[2], known ? `${student}%` : null, student, 'pct--student');
    if (!known) studentCell.replaceChildren(el('span', { class: 'small muted' }, 'Hỏi Trung tâm Tuyển sinh'));
    if (verify) studentCell.append(el('span', { class: 'tiny muted', title: 'Mức hỗ trợ cần Trung tâm Tuyển sinh xác nhận' }, '* cần xác nhận'));
    return [
      cell(SUPPORT_COLS[0], m.state_support, state),
      cell(SUPPORT_COLS[1], m.enterprise_support, ent),
      studentCell,
    ];
  }

  function levelCells(m) {
    return LEVEL_COLS.map((c) => el('td', { class: 'lvl-cell', 'data-label': c.short },
      m.levels.includes(c.code)
        ? el('span', { class: 'tick', role: 'img', 'aria-label': `Có tuyển ${c.short}`, title: `Có tuyển ${c.long}` }, '✓')
        : el('span', { class: 'dash', 'aria-label': `Không tuyển ${c.short}` }, '–')));
  }

  function headerButton(kind, col) {
    return el('th', { scope: 'col', class: 'sub-th' },
      el('button', { type: 'button', class: 'th-btn', 'data-action': 'explain', 'data-kind': kind, 'data-code': col.code, title: `Bấm để trợ lý giải thích: ${col.long}` }, col.short));
  }

  function renderHead() {
    $('#major-head').replaceChildren(
      el('tr', {},
        el('th', { rowspan: '2', scope: 'col' }, 'Ngành, nghề'),
        el('th', { rowspan: '2', scope: 'col' }, 'Khoa'),
        el('th', { colspan: '4', scope: 'colgroup', class: 'group-th' }, 'Hệ tuyển sinh'),
        el('th', { colspan: '3', scope: 'colgroup', class: 'group-th' }, 'Hỗ trợ học phí (% và số tiền mỗi tháng)')),
      el('tr', {}, LEVEL_COLS.map((c) => headerButton('level', c)), SUPPORT_COLS.map((c) => headerButton('support', c))));
  }

  function renderLegend() {
    $('#major-legend').replaceChildren(
      el('p', { class: 'legend-title' }, el('strong', {}, 'Chú thích:'), ' bấm vào tên cột để trợ lý tư vấn giải thích.'),
      el('div', { class: 'legend-row' },
        LEVEL_COLS.map((c) => el('button', { type: 'button', class: 'legend-item', 'data-action': 'explain', 'data-kind': 'level', 'data-code': c.code },
          el('abbr', { title: c.long }, c.short), ` = ${c.long}`))),
      el('div', { class: 'legend-row' },
        SUPPORT_COLS.map((c) => el('button', { type: 'button', class: 'legend-item', 'data-action': 'explain', 'data-kind': 'support', 'data-code': c.code },
          el('strong', {}, c.short), ` = ${c.long}`))),
      el('p', { class: 'small muted mb-0' }, 'Số tiền tính trên học phí Trung cấp/Cao đẳng 1.800.000 – 2.400.000 đ/tháng tùy ngành; chưa gồm miễn giảm theo đối tượng và học bổng.'));
  }

  async function load() {
    const q = new URLSearchParams();
    for (const k of ['q', 'level', 'faculty', 'support']) if (form[k].value) q.set(k, form[k].value);
    history.replaceState(null, '', q.toString() ? `?${q}` : location.pathname);
    const { majors } = await apiClient.get(`/api/handbook/majors?${q}`);
    $('#major-count').textContent = `${majors.length} ngành phù hợp bộ lọc`;
    const rows = majors.map((m) => el('tr', {},
      el('td', { class: 'name-cell' }, el('a', { href: `/nganh-chi-tiet.html?code=${encodeURIComponent(m.code)}` }, m.name),
        m.listed_in_latest_table ? null : el('div', { class: 'small muted' }, 'Không có trong bảng ngành 08/2026 – hỏi lại trường')),
      el('td', { class: 'small' }, m.faculty),
      levelCells(m),
      supportCells(m)));
    $('#major-rows').replaceChildren(...(rows.length ? rows : [el('tr', {}, el('td', { colspan: '9', class: 'empty' }, 'Không có ngành phù hợp. Thử bỏ bớt bộ lọc.'))]));
  }

  async function init() {
    renderHead();
    renderLegend();
    const meta = await hht.meta();
    for (const [k, v] of Object.entries(meta.levels)) form.level.append(el('option', { value: k }, v));
    const { faculties } = await apiClient.get('/api/handbook/overview');
    for (const f of faculties) form.faculty.append(el('option', { value: f.faculty }, f.faculty));
    const p = params();
    for (const k of ['q', 'level', 'faculty', 'support']) if (p.get(k)) form[k].value = p.get(k);
    form.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => load().catch((e) => toast(e.message, 'error')), 250); });
    actionDelegate.register({
      'filter-majors': () => load(),
      explain: (b) => openChat({ explain: `${b.dataset.kind}:${b.dataset.code}` }),
    });
    await load();
  }
  init().catch((e) => toast(e.message, 'error'));
})();
