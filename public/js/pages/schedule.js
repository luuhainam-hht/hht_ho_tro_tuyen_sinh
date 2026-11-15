(function () {
  'use strict';
  const LABEL = { ONGOING: ['Đang diễn ra', 'badge--go'], UPCOMING: ['Sắp tới', 'badge--wait'], PAST: ['Đã qua', ''], UNKNOWN: ['', ''] };
  apiClient.get('/api/handbook/schedule').then(({ items }) => {
    const groups = new Map();
    for (const i of items) { if (!groups.has(i.audience)) groups.set(i.audience, []); groups.get(i.audience).push(i); }
    $('#schedule').replaceChildren(...[...groups].map(([aud, list]) => el('section', { class: 'mb-l' }, el('h2', {}, aud),
      el('ol', { class: 'timeline' }, list.map((i) => el('li', { 'data-status': i.status },
        el('strong', {}, i.title, ' '), LABEL[i.status][0] ? el('span', { class: `badge ${LABEL[i.status][1]}` }, LABEL[i.status][0]) : null,
        el('div', { class: 'small' }, i.detail)))))));
  }).catch((e) => toast(e.message, 'error'));
})();
