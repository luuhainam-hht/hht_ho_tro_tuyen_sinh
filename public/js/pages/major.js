(function () {
  'use strict';
  const { money, params, fmtDate } = hht;
  const code = params().get('code');

  /** Cột theo thứ tự Nhà trường yêu cầu: Hệ 9+, SC, TC, CĐ. */
  const LEVELS = [
    ['HE_9_PLUS', 'Hệ 9+', 'THPT – Cao đẳng'],
    ['SO_CAP', 'SC', 'Sơ cấp'],
    ['TRUNG_CAP', 'TC', 'Trung cấp'],
    ['CAO_DANG', 'CĐ', 'Cao đẳng'],
  ];
  const CAMPUSES = [['quota_cs1', 'Cơ sở 1'], ['quota_cs2', 'Cơ sở 2'], ['quota_cs3', 'Cơ sở 3']];
  const ITEM_KIND = { DOC_CHECKLIST: 'Hồ sơ cần nộp', SCHEDULE: 'Đợt nhận hồ sơ', ONLINE_GUIDE_STEP: 'Hướng dẫn đăng ký', CONTACT: 'Liên hệ' };
  const dash = () => el('span', { class: 'dash', 'aria-label': 'Chưa có thông tin' }, '–');

  function tuitionText(p) {
    const lo = p.tuition_min ?? p.tuition_max;
    const hi = p.tuition_max ?? p.tuition_min;
    const range = lo ? `${money(lo)}${hi && hi !== lo ? ` – ${money(hi)}` : ''}/tháng` : null;
    if (!range && !p.tuition_note) return null;
    return [range ? el('strong', {}, range) : null, p.tuition_note ? el('div', { class: 'small muted' }, p.tuition_note) : null];
  }

  /**
   * Bảng thông tin tuyển sinh: cột = hệ (9+, SC, TC, CĐ); hàng = Chỉ tiêu (Cơ sở 1/2/3, tổng),
   * Thời gian học, Học phí, Phương thức. Trên điện thoại mỗi hệ thành một thẻ (CSS).
   */
  function programTable(m) {
    const byLevel = Object.fromEntries((m.programs || []).map((p) => [p.level, p]));
    const cols = LEVELS.filter(([k]) => byLevel[k]);
    if (!cols.length) return el('p', { class: 'muted' }, 'Trường chưa công bố hệ tuyển sinh cho ngành này năm nay.');
    const hasCampus = (key) => cols.some(([k]) => byLevel[k][key]);
    const campuses = CAMPUSES.filter(([key]) => hasCampus(key));
    const cell = (k, content, label) => el('td', { 'data-label': label }, content ?? dash());
    const groupRow = (title) => el('tr', { class: 'pt-group' }, el('th', { scope: 'rowgroup', colspan: String(cols.length + 1) }, title));
    const row = (label, fn, cls = '') => el('tr', { class: cls }, el('th', { scope: 'row' }, label), cols.map(([k]) => cell(k, fn(byLevel[k]), label)));

    const total = (p) => {
      const n = CAMPUSES.reduce((s, [key]) => s + (p[key] || 0), 0);
      return n ? el('strong', {}, n.toLocaleString('vi-VN')) : null;
    };
    const body = [
      groupRow('Chỉ tiêu'),
      ...(campuses.length
        ? [...campuses.map(([key, label]) => row(label, (p) => (p[key] ? p[key].toLocaleString('vi-VN') : null))),
          campuses.length > 1 ? row('Tổng', total, 'pt-total') : null]
        : [row('Theo cơ sở', () => el('span', { class: 'small muted' }, 'Chưa công bố'))]),
      groupRow('Thời gian học'),
      row('Thời gian', (p) => p.duration),
      groupRow('Học phí'),
      row('Học phí', tuitionText),
      groupRow('Phương thức xét tuyển'),
      row('Phương thức', (p) => p.methods),
    ];
    if (cols.some(([k]) => byLevel[k].note)) body.push(groupRow('Ghi chú'), row('Ghi chú', (p) => (p.note ? el('span', { class: 'small' }, p.note) : null)));

    return el('div', { class: 'pt-wrap' }, el('table', { class: 'program-table' },
      el('caption', { class: 'visually-hidden' }, `Thông tin tuyển sinh ngành ${m.name} theo hệ đào tạo`),
      el('thead', {}, el('tr', {},
        el('th', { scope: 'col', class: 'pt-corner' }, 'Hệ tuyển sinh'),
        cols.map(([, short, long]) => el('th', { scope: 'col' }, el('span', { class: 'pt-level' }, short), el('span', { class: 'pt-level-long' }, long))))),
      el('tbody', {}, body.filter(Boolean))));
  }

  /** Điện thoại: mỗi hệ một thẻ (bảng 4 cột quá chật trên màn hẹp). */
  function programCards(m) {
    const byLevel = Object.fromEntries((m.programs || []).map((p) => [p.level, p]));
    const cols = LEVELS.filter(([k]) => byLevel[k]);
    if (!cols.length) return null;
    return el('div', { class: 'program-cards' }, cols.map(([k, short, long]) => {
      const p = byLevel[k];
      const quota = CAMPUSES.filter(([key]) => p[key]).map(([key, label]) => `${label}: ${p[key].toLocaleString('vi-VN')}`);
      const dl = el('dl', { class: 'spec' });
      const add = (label, v) => dl.append(el('dt', {}, label), el('dd', {}, v ?? dash()));
      add('Chỉ tiêu', quota.length ? quota.join(' · ') : null);
      add('Thời gian học', p.duration);
      add('Học phí', tuitionText(p));
      add('Phương thức', p.methods);
      if (p.note) add('Ghi chú', p.note);
      return el('section', { class: 'program-card' }, el('h3', {}, short, el('span', { class: 'pt-level-long' }, long)), dl);
    }));
  }

  /** Mục riêng của ngành do Phòng Tuyển sinh / Khoa thêm (hồ sơ, đợt, hướng dẫn, liên hệ). */
  function majorItems(m) {
    if (!m.items?.length) return null;
    const groups = Object.keys(ITEM_KIND).map((k) => [k, m.items.filter((i) => i.kind === k)]).filter(([, list]) => list.length);
    return el('div', { class: 'panel' }, el('h2', {}, 'Thông tin riêng của ngành'),
      groups.map(([k, list]) => [el('h3', {}, ITEM_KIND[k]), el('ul', { class: 'major-items' }, list.map((i) => el('li', {},
        el('strong', {}, i.title),
        i.detail ? el('div', { class: 'small' }, i.detail) : null,
        i.date_from || i.date_to ? el('div', { class: 'small muted' }, `${fmtDate(i.date_from)} → ${fmtDate(i.date_to)}`) : null)))]));
  }

  async function load() {
    if (!code) { location.href = '/nganh.html'; return; }
    const { major: m } = await apiClient.get(`/api/handbook/majors/${encodeURIComponent(code)}`);
    document.title = `${m.name} – Tuyển sinh HHT`;
    $('#major-name').textContent = m.name;
    const cfg = (await hht.meta().catch(() => ({}))).config || {};
    $('#major-faculty').replaceChildren(hht.facultyLink(m.faculty, cfg, { label: `Khoa ${m.faculty}` }), m.occupation_code ? ` · Mã nghề ${m.occupation_code}` : '');

    const support = el('dl', { class: 'spec mt-m' });
    const srow = (k, v) => v && support.append(el('dt', {}, k), el('dd', {}, v));
    srow('Nhà nước hỗ trợ', m.state_support);
    srow('Doanh nghiệp hỗ trợ', m.enterprise_support);

    const main = el('div', {},
      el('div', { class: 'panel' }, el('h2', {}, 'Giới thiệu'), el('p', {}, m.description || 'Đang cập nhật.'),
        m.career_paths?.length ? [el('h3', {}, 'Cơ hội việc làm'), el('ul', {}, m.career_paths.map((c) => el('li', {}, c)))] : null,
        m.profile_is_sample ? el('p', { class: 'small muted' }, 'Mô tả và hướng nghề nghiệp mang tính tham khảo, đang được cán bộ tư vấn hoàn thiện.') : null),
      el('div', { class: 'panel' }, el('h2', {}, 'Thông tin tuyển sinh'), programTable(m), programCards(m),
        support.childElementCount ? [el('h3', { class: 'mt-m' }, 'Hỗ trợ học phí'), support] : null,
        (m.state_support || m.enterprise_support) && m.support_needs_verify
          ? el('p', { class: 'note small mt-m' }, 'Mức hỗ trợ học phí của ngành này khác nhau giữa các bảng ngành đã công bố. Vui lòng xác nhận với Trung tâm Tuyển sinh.') : null,
        !m.listed_in_latest_table ? el('p', { class: 'note note--stop small mt-m' }, 'Ngành không có trong bảng ngành tháng 08/2026 (có thể đã hết chỉ tiêu đợt trước). Hãy gọi hotline để biết còn tuyển hay không.') : null),
      majorItems(m));
    const side = el('div', {},
      el('div', { class: 'panel' }, el('h3', {}, 'Bạn còn thắc mắc?'),
        el('p', { class: 'small' }, 'Hỏi thêm về học phí, thời gian học, cơ hội việc làm của ngành này.'),
        el('div', { class: 'btn-row' },
          el('button', { class: 'btn btn--tag', 'data-action': 'ask', 'data-question': `Ngành ${m.name} học những gì, ra trường làm gì?`, 'data-major': m.code }, 'Hỏi thêm về ngành này'),
          el('a', { class: 'btn', href: `/ho-so.html?major=${encodeURIComponent(m.code)}` }, 'Xem hồ sơ cần nộp'))),
      m.related?.length ? el('div', { class: 'panel' }, el('h3', {}, 'Cùng khoa'),
        el('ul', {}, m.related.map((r) => el('li', {}, el('a', { href: `/nganh-chi-tiet.html?code=${encodeURIComponent(r.code)}` }, r.name))))) : null);
    $('#major-detail').replaceChildren(main, side);
  }
  load().catch((e) => { $('#major-name').textContent = 'Không tìm thấy ngành'; toast(e.message, 'error'); });
})();
