/**
 * Ủy quyền sự kiện qua data-action (CSP cấm onclick inline).
 *   <button data-action="call-next">  +  actionDelegate.register({ 'call-next': (el, ev) => … })
 * Form: <form data-action="submit-ticket"> nhận sự kiện submit (đã preventDefault).
 */
(function () {
  'use strict';
  const registry = Object.create(null);

  async function dispatch(el, ev) {
    const fn = registry[el.dataset.action];
    if (!fn) return;
    ev.preventDefault();
    if (el.dataset.busy === '1') return; // chống bấm đúp gửi 2 lần
    el.dataset.busy = '1';
    try { await fn(el, ev); } finally { delete el.dataset.busy; }
  }

  document.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-action]');
    if (el && el.tagName !== 'FORM') dispatch(el, ev);
  });
  document.addEventListener('submit', (ev) => {
    const form = ev.target.closest('form[data-action]');
    if (form) dispatch(form, ev);
  });

  window.actionDelegate = { register(map) { Object.assign(registry, map); } };
})();
