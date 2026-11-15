(function () {
  'use strict';
  const SOURCE_LABEL = { FAQ: 'FAQ đã duyệt', RAG: 'Văn bản (RAG)', CACHE: 'Bộ nhớ đệm', FALLBACK: 'Chưa trả lời được', RULE: 'Chào hỏi/ngoài phạm vi', HANDOFF: 'Chuyển cán bộ' };
  const DOW = ['', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];

  const kpi = (label, value, note) => el('div', { class: 'kpi' }, el('span', {}, label), el('strong', {}, value ?? '–'), note ? el('span', { class: 'small' }, note) : null);
  function barChart(rows, labelKey, valueKey) {
    const max = Math.max(1, ...rows.map((r) => r[valueKey]));
    return el('div', { class: 'chart' }, rows.length ? rows.map((r) => {
      const fill = el('span');
      fill.style.width = `${(r[valueKey] / max) * 100}%`;
      return el('div', { class: 'chart-row' }, el('span', {}, r[labelKey] || '—'), el('span', { class: 'bar-track' }, fill), el('strong', {}, String(r[valueKey])));
    }) : el('p', { class: 'empty' }, 'Chưa có dữ liệu'));
  }

  admin.register({
    id: 'dashboard', title: 'Tổng quan', perm: 'ANALYTICS', events: ['QUESTION_LOGGED', 'HANDOFF_CREATED', 'APPOINTMENT_BOOKED'],
    async render(root) {
      const f = root.dataset.from || '';
      const t = root.dataset.to || '';
      const q = new URLSearchParams(Object.entries({ from: f, to: t }).filter(([, v]) => v));
      const [s, u, miss] = await Promise.all([
        apiClient.get(`/api/admin/analytics/summary?${q}`), apiClient.get(`/api/admin/analytics/unanswered?${q}`), apiClient.get(`/api/admin/analytics/missing-docs?${q}`),
      ]);
      const byDay = new Map();
      for (const r of s.byDay) byDay.set(r.day, (byDay.get(r.day) || 0) + r.n);
      const days = [...byDay.entries()];
      const maxDay = Math.max(1, ...days.map(([, n]) => n));
      const fallback = s.sourceShare.find((x) => x.source === 'FALLBACK');
      const tokensToday = s.tokens.at(-1);
      const heat = new Map(s.heatmap.map((h) => [`${h.dow}-${h.hour}`, h.n]));
      const maxHeat = Math.max(1, ...s.heatmap.map((h) => h.n));

      root.replaceChildren(
        el('form', { class: 'toolbar', 'data-action': 'dash-range' },
          el('label', {}, 'Từ ngày', el('input', { type: 'date', name: 'from', value: s.range.from })),
          el('label', {}, 'Đến ngày', el('input', { type: 'date', name: 'to', value: s.range.to })),
          el('button', { class: 'btn btn--sm', type: 'submit' }, 'Xem'),
          el('a', { class: 'btn btn--sm btn--tag', href: '#', 'data-action': 'export-xlsx' }, 'Xuất báo cáo Excel')),
        el('div', { class: 'kpis' },
          kpi('Câu hỏi', s.questions.toLocaleString('vi-VN'), `${s.range.from.split('-').reverse().join('/')} – ${s.range.to.split('-').reverse().join('/')}`),
          kpi('Chưa trả lời được', fallback ? `${fallback.percent}%` : '0%', 'tỉ lệ FALLBACK'),
          kpi('Độ trễ p50 / p95', s.latency.p50 ? `${s.latency.p50} / ${s.latency.p95} ms` : '–'),
          kpi('Đánh giá của thí sinh', `${s.ratings.up} / ${s.ratings.down}`, 'hữu ích / chưa đúng'),
          kpi('Câu hỏi chờ cán bộ', String(s.handoff.backlog), s.handoff.overdue ? `${s.handoff.overdue} quá 24 giờ` : 'không có quá hạn'),
          kpi('Lịch hẹn nộp hồ sơ', String(s.appointments.total), `${s.appointments.attended} đã đến · ${s.appointments.no_show} vắng`)),
        el('div', { class: 'grid-2' },
          el('section', { class: 'panel' }, el('h3', {}, 'Số câu hỏi theo ngày'),
            days.length ? el('div', { class: 'spark', role: 'img', 'aria-label': 'Biểu đồ số câu hỏi theo ngày' }, days.map(([d, n]) => {
              const b = el('span', { title: `${d}: ${n}` });
              b.style.height = `${(n / maxDay) * 100}%`;
              return b;
            })) : el('p', { class: 'empty' }, 'Chưa có câu hỏi')),
          el('section', { class: 'panel' }, el('h3', {}, 'Cách trợ lý trả lời'), barChart(s.sourceShare.map((x) => ({ ...x, label: SOURCE_LABEL[x.source] || x.source })), 'label', 'n'))),
        el('div', { class: 'grid-2 mt-m' },
          el('section', { class: 'panel' }, el('h3', {}, 'Chủ đề được hỏi nhiều'), barChart(s.topTopics, 'label', 'n')),
          el('section', { class: 'panel' }, el('h3', {}, 'Ngành được hỏi nhiều'), barChart(s.topMajors, 'name', 'n'))),
        el('section', { class: 'panel mt-m' }, el('h3', {}, 'Giờ cao điểm (giờ Việt Nam)'),
          el('div', { class: 'heat' }, el('span'), [...Array(24).keys()].map((h) => el('span', {}, h % 3 === 0 ? String(h) : '')),
            [1, 2, 3, 4, 5, 6, 7].map((d) => [el('span', {}, DOW[d]), [...Array(24).keys()].map((h) => {
              const n = heat.get(`${d}-${h}`) || 0;
              const cell = el('i', { title: `${DOW[d]} ${h}h: ${n}` });
              if (n) cell.style.background = `rgba(19,37,74,${0.15 + 0.85 * (n / maxHeat)})`;
              return cell;
            })]))),
        el('div', { class: 'grid-2 mt-m' },
          el('section', { class: 'panel' }, el('h3', {}, `Câu hỏi chưa trả lời được (${u.total})`),
            el('p', { class: 'small muted' }, 'Gom theo độ giống nhau – gợi ý bổ sung FAQ hoặc văn bản vào kho tri thức.'),
            admin.table(['Câu hỏi đại diện', 'Số lượt'], u.clusters.slice(0, 12).map((c) => el('tr', {}, el('td', {}, c.representative), el('td', {}, String(c.count)))), 'Không có câu hỏi nào bị bỏ ngỏ')),
          el('section', { class: 'panel' }, el('h3', {}, 'Ngành được gợi ý nhiều nhất'), barChart(s.recommendedMajors, 'name', 'n'),
            el('h3', { class: 'mt-m' }, 'Giấy tờ hay thiếu khi đặt lịch'), barChart(miss.items, 'title', 'n'))),
        el('section', { class: 'panel mt-m' }, el('h3', {}, 'Token AI theo ngày'),
          el('p', { class: 'small muted' }, `Trần mỗi ngày: ${s.dailyTokenBudget.toLocaleString('vi-VN')} token${tokensToday ? ` · gần nhất ${tokensToday.day}: ${(tokensToday.tokens_in + tokensToday.tokens_out).toLocaleString('vi-VN')}` : ''}`),
          admin.table(['Ngày', 'Token vào', 'Token ra', 'Lượt gọi'], s.tokens.map((x) => el('tr', {}, el('td', {}, x.day), el('td', {}, String(x.tokens_in)), el('td', {}, String(x.tokens_out)), el('td', {}, String(x.requests)))), 'Chưa gọi LLM (chưa cấu hình API key hoặc chưa phát sinh)')));
    },
  });

  actionDelegate.register({
    'dash-range'(form) { const root = $('#tab'); root.dataset.from = form.from.value; root.dataset.to = form.to.value; admin.reload(); },
    async 'export-xlsx'() {
      const root = $('#tab');
      const q = new URLSearchParams(Object.entries({ from: root.dataset.from || '', to: root.dataset.to || '' }).filter(([, v]) => v));
      try {
        const res = await apiClient.raw('GET', `/api/admin/analytics/export.xlsx?${q}`);
        const url = URL.createObjectURL(await res.blob());
        const a = el('a', { href: url, download: 'bao-cao-tu-van-tuyen-sinh.xlsx' });
        document.body.append(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      } catch (e) { toast(e.message, 'error'); }
    },
  });
})();
