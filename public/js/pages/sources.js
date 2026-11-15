(function () {
  'use strict';
  apiClient.get('/api/handbook/sources').then(({ items }) => {
    $('#sources').replaceChildren(...items.map((s) => el('tr', {},
      el('td', {}, s.source_code),
      el('td', {}, s.source_url ? el('a', { href: s.source_url, target: '_blank', rel: 'noopener' }, s.title) : s.title),
      el('td', {}, hht.fmtDate(s.issued_date)),
      el('td', {}, el('span', { class: `badge ${s.status === 'PUBLISHED' ? 'badge--go' : ''}` }, s.status === 'PUBLISHED' ? 'Đang dùng' : 'Chỉ đối chiếu')))));
  }).catch((e) => toast(e.message, 'error'));
})();
