(function () {
  'use strict';
  const { LEVEL_SHORT, money, params } = hht;
  const code = params().get('code');

  async function load() {
    if (!code) { location.href = '/nganh.html'; return; }
    const { major: m } = await apiClient.get(`/api/handbook/majors/${encodeURIComponent(code)}`);
    document.title = `${m.name} – Tuyển sinh HHT`;
    $('#major-name').textContent = m.name;
    $('#major-faculty').textContent = `Khoa ${m.faculty}${m.occupation_code ? ` · Mã nghề ${m.occupation_code}` : ''}`;
    const spec = el('dl', { class: 'spec' });
    const row = (k, v) => v && spec.append(el('dt', {}, k), el('dd', {}, v));
    row('Hệ tuyển sinh', m.levels.length ? m.levels.map((l) => LEVEL_SHORT[l]).join(', ') : 'Trường chưa công bố');
    row('Thời gian học', m.duration);
    row('Học phí', m.tuition_per_month_min ? `${money(m.tuition_per_month_min)} – ${money(m.tuition_per_month_max)}/tháng (khung chung hệ TC, CĐ; tùy ngành)` : null);
    row('Hệ 9+', m.levels.includes('HE_9_PLUS') ? 'Phần Trung cấp miễn 100% học phí' : null);
    row('Chỉ tiêu hệ 9+', [m.quota_9plus_cs1 ? `Cơ sở 1: ${m.quota_9plus_cs1}` : null, m.quota_9plus_cs2 ? `Cơ sở 2: ${m.quota_9plus_cs2}` : null].filter(Boolean).join(' · '));
    row('Nhà nước hỗ trợ', m.state_support);
    row('Doanh nghiệp hỗ trợ', m.enterprise_support);
    row('Phương thức', (m.admission_methods || []).join('; '));

    const main = el('div', {},
      el('div', { class: 'panel' }, el('h2', {}, 'Giới thiệu'), el('p', {}, m.description || 'Đang cập nhật.'),
        m.career_paths?.length ? [el('h3', {}, 'Cơ hội việc làm'), el('ul', {}, m.career_paths.map((c) => el('li', {}, c)))] : null,
        m.profile_is_sample ? el('p', { class: 'small muted' }, 'Mô tả và hướng nghề nghiệp mang tính tham khảo, đang được cán bộ tư vấn hoàn thiện.') : null),
      el('div', { class: 'panel' }, el('h2', {}, 'Thông tin tuyển sinh'), spec,
        (m.state_support || m.enterprise_support) && m.support_needs_verify
          ? el('p', { class: 'note small mt-m' }, 'Mức hỗ trợ học phí của ngành này khác nhau giữa các bảng ngành đã công bố. Vui lòng xác nhận với Trung tâm Tuyển sinh.') : null,
        !m.listed_in_latest_table ? el('p', { class: 'note note--stop small mt-m' }, 'Ngành không có trong bảng ngành tháng 08/2026 (có thể đã hết chỉ tiêu đợt trước). Hãy gọi hotline để biết còn tuyển hay không.') : null));
    const side = el('div', {},
      el('div', { class: 'panel' }, el('h3', {}, 'Bạn còn thắc mắc?'),
        el('p', { class: 'small' }, 'Hỏi thêm về học phí, thời gian học, cơ hội việc làm của ngành này.'),
        el('div', { class: 'btn-row' },
          el('button', { class: 'btn btn--tag', 'data-action': 'ask', 'data-question': `Ngành ${m.name} học những gì, ra trường làm gì?`, 'data-major': m.code }, 'Hỏi thêm về ngành này'),
          el('a', { class: 'btn', href: `/ho-so.html?major=${encodeURIComponent(m.code)}` }, 'Xem checklist hồ sơ'))),
      m.related?.length ? el('div', { class: 'panel' }, el('h3', {}, 'Cùng khoa'),
        el('ul', {}, m.related.map((r) => el('li', {}, el('a', { href: `/nganh-chi-tiet.html?code=${encodeURIComponent(r.code)}` }, r.name))))) : null);
    $('#major-detail').replaceChildren(main, side);
  }
  load().catch((e) => { $('#major-name').textContent = 'Không tìm thấy ngành'; toast(e.message, 'error'); });
})();
