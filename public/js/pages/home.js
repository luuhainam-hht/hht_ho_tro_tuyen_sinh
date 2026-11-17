(function () {
  'use strict';
  const { LEVEL_SHORT, fmtDate } = hht;

  actionDelegate.register({
    'hero-ask'(form) {
      const q = form.q.value.trim();
      if (q) openChat({ question: q });
      form.reset();
    },
  });

  function renderBoard(overview) {
    const list = $('#board-list');
    const items = [...overview.ongoingSchedule, ...overview.upcomingSchedule].slice(0, 5);
    if (!items.length) {
      list.replaceChildren(el('li', {}, 'Hiện không có đợt nào đang mở. Theo dõi thông báo tuyển sinh năm tới hoặc gọi hotline.'));
      $('#board-title').textContent = 'Lịch tuyển sinh';
      return;
    }
    list.replaceChildren(...items.map((s) => el('li', {},
      el('span', {}, el('span', { class: `badge ${s.status === 'ONGOING' ? 'badge--go' : 'badge--wait'}` }, s.status === 'ONGOING' ? 'Đang diễn ra' : 'Sắp tới')),
      el('strong', {}, `${s.title}`),
      el('span', { class: 'small muted' }, `${s.audience} · ${s.detail}`))));
  }

  async function load() {
    try {
      const [ov, guide, majors] = await Promise.all([
        apiClient.get('/api/handbook/overview'), apiClient.get('/api/handbook/guide'), apiClient.get('/api/handbook/majors'),
      ]);
      renderBoard(ov);
      $('#hero-facts').replaceChildren(
        el('span', {}, 'Trường công lập trực thuộc UBND TP Hà Nội'),
        el('span', {}, el('strong', {}, String(ov.majorCount)), ' ngành, nghề trong cẩm nang'),
        el('span', {}, el('strong', {}, String(ov.faculties.length)), ' khoa đào tạo'),
        el('span', {}, 'Xét tuyển, không thi đầu vào'));
      $('#steps').replaceChildren(...guide.steps.map((s) => el('li', {}, el('h3', {}, s.title), el('p', {}, s.detail))));
      const siteCfg = (await hht.meta().catch(() => ({}))).config || {};
      const groups = new Map();
      for (const m of majors.majors) {
        if (!groups.has(m.faculty)) groups.set(m.faculty, []);
        groups.get(m.faculty).push(m);
      }
      $('#faculties').replaceChildren(...[...groups].map(([fac, list]) => el('div', { class: 'faculty' },
        el('h3', {}, el('span', {}, hht.facultyLink(fac, siteCfg)), el('small', {}, `${list.length} ngành`)),
        el('ul', {}, list.map((m) => el('li', {}, el('a', { href: `/nganh-chi-tiet.html?code=${encodeURIComponent(m.code)}` },
          m.name, ' ', el('span', { class: 'small muted' }, m.levels.map((l) => LEVEL_SHORT[l]).join(', ')))))))));
    } catch (err) {
      toast(err.message, 'error');
    }
    void fmtDate;
  }
  load();
})();
