(function () {
  'use strict';
  const isLink = (s) => /^https?:\/\//.test(s) || /^(facebook|m\.me)/.test(s);
  apiClient.get('/api/handbook/contacts').then(({ items }) => {
    const groups = new Map();
    for (const i of items) { if (!groups.has(i.audience)) groups.set(i.audience, []); groups.get(i.audience).push(i); }
    $('#contacts').replaceChildren(...[...groups].map(([g, list]) => el('section', { class: 'mb-l' }, el('h2', {}, g),
      el('dl', { class: 'spec' }, list.flatMap((i) => [el('dt', {}, i.title), el('dd', {}, i.detail.split(/\s*[;]\s*/).map((part, idx) => [idx ? '; ' : '',
        /^[\d\s()]{9,}$/.test(part) ? el('a', { href: `tel:${part.replace(/[^\d]/g, '')}` }, part)
          : /@/.test(part) && !/\s/.test(part) ? el('a', { href: `mailto:${part}` }, part)
            : isLink(part) ? el('a', { href: part.startsWith('http') ? part : `https://${part}`, target: '_blank', rel: 'noopener' }, part) : part]))])))));
  }).catch((e) => toast(e.message, 'error'));
})();
