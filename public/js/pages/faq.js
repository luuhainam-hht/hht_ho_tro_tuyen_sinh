(function () {
  'use strict';
  let items = [];
  let topic = '';
  let query = '';
  const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase();

  function render(topics) {
    const list = items.filter((i) => (!topic || i.topic === topic) && (!query || norm(`${i.question} ${i.answer}`).includes(norm(query))));
    $('#topics').replaceChildren(el('button', { type: 'button', 'data-action': 'topic', 'data-value': '', 'aria-pressed': String(!topic) }, 'Tất cả'),
      ...[...new Set(items.map((i) => i.topic))].map((t) => el('button', { type: 'button', 'data-action': 'topic', 'data-value': t, 'aria-pressed': String(topic === t) }, topics[t] || t)));
    $('#faq').replaceChildren(...(list.length ? list.map((i) => el('details', {},
      el('summary', {}, i.question),
      el('div', { class: 'answer' }, i.answer, el('p', { class: 'sources mt-xs' }, `Nguồn: ${i.source_codes.join(', ')}${i.reliability === 'B' ? ' · nên đối chiếu lại với văn bản gốc' : ''}`))))
      : [el('p', { class: 'empty' }, 'Không có câu hỏi phù hợp. Bạn có thể đặt câu hỏi trong khung tư vấn.')]));
  }

  Promise.all([apiClient.get('/api/handbook/faq'), hht.meta()]).then(([res, meta]) => {
    items = res.items;
    actionDelegate.register({
      topic: (b) => { topic = b.dataset.value; render(meta.topics); },
      'faq-search': (f) => { query = f.q.value.trim(); render(meta.topics); },
    });
    $('#faq-q').addEventListener('input', (e) => { query = e.target.value.trim(); render(meta.topics); });
    render(meta.topics);
  }).catch((e) => toast(e.message, 'error'));
})();
