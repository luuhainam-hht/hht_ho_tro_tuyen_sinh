(function () {
  'use strict';
  const STORE_KEY = 'hht.checklist';
  let audience = null;
  let items = [];

  const load = () => { try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { return {}; } };
  const save = (s) => { try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch { /* chế độ riêng tư */ } };

  function render() {
    const state = load();
    const checked = new Set(state[audience] || []);
    $('#doc-list').replaceChildren(...items.map((i) => el('li', {}, el('label', { class: 'doc' },
      el('input', { type: 'checkbox', value: i.code, checked: checked.has(i.code) }),
      el('span', {},
        el('strong', {}, i.title, ' ', el('span', { class: `badge ${i.is_mandatory ? 'badge--stop' : ''}` }, i.is_mandatory ? 'Bắt buộc' : 'Nếu thuộc diện')),
        el('span', { class: 'small' }, i.detail),
        i.copyTypeLabel ? el('span', { class: 'small muted' }, ` · ${i.copyTypeLabel}${i.quantity > 1 ? `, ${i.quantity} bản` : ''}`) : null)))));
    update();
  }

  function update() {
    const codes = $$('#doc-list input:checked').map((x) => x.value);
    const state = load();
    state[audience] = codes;
    save(state);
    const mandatory = items.filter((i) => i.is_mandatory);
    const have = mandatory.filter((i) => codes.includes(i.code)).length;
    $('#progress-bar').style.width = `${mandatory.length ? (have / mandatory.length) * 100 : 0}%`;
    $('#progress-text').textContent = `Đã có ${have}/${mandatory.length} giấy bắt buộc`;
    const missing = mandatory.filter((i) => !codes.includes(i.code));
    $('#missing').replaceChildren(...(missing.length
      ? [el('p', { class: 'mb-0' }, 'Còn thiếu:'), el('ul', {}, missing.map((m) => el('li', {}, m.title)))]
      : [el('p', { class: 'badge badge--go' }, 'Đã đủ giấy tờ bắt buộc')]));
    $('#to-booking').href = `/dat-lich.html?audience=${audience}`;
  }

  async function pick(code) {
    audience = code;
    $$('#audiences .choice').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.audience === code)));
    const meta = await hht.meta();
    $('#checklist-title').textContent = `Hồ sơ: ${meta.audiences[code]}`;
    items = (await apiClient.get(`/api/handbook/checklist?audience=${code}`)).items;
    render();
  }

  async function init() {
    const meta = await hht.meta();
    const hint = { CHINH_QUY: 'Đã tốt nghiệp THPT hoặc THCS', HE_9_PLUS: 'Vào lớp 10 hệ 9+', BO_DOI: 'Có thẻ học nghề' };
    $('#audiences').replaceChildren(...Object.entries(meta.audiences).map(([k, v]) => el('button', { type: 'button', class: 'choice', 'data-action': 'pick-audience', 'data-audience': k, 'aria-pressed': 'false' }, v, el('small', {}, hint[k]))));
    actionDelegate.register({ 'pick-audience': (b) => pick(b.dataset.audience) });
    $('#doc-list').addEventListener('change', update);
    await pick(hht.params().get('audience') || 'CHINH_QUY');
  }
  init().catch((e) => toast(e.message, 'error'));
})();
