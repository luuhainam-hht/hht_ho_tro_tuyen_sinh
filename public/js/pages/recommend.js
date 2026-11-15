(function () {
  'use strict';
  const { LEVEL_SHORT } = hht;
  const root = $('#recommend');
  const SCALE = ['Không đúng', 'Ít đúng', 'Phân vân', 'Khá đúng', 'Rất đúng'];
  const PART_LABEL = { riasec: 'Sở thích nghề', subject: 'Môn thế mạnh', preference: 'Mong muốn' };

  const likert = (name, text, labels = SCALE) => el('div', { class: 'likert', role: 'radiogroup', 'aria-label': text },
    el('span', {}, text),
    el('div', { class: 'likert-scale' }, labels.map((l, i) => el('label', {}, el('input', { type: 'radio', name, value: String(i + 1) }), el('strong', {}, String(i + 1)), l))));

  function renderForm(q) {
    root.replaceChildren(el('form', { class: 'form', 'data-action': 'submit-quiz' },
      el('fieldset', {}, el('legend', {}, 'Trình độ hiện tại của em'),
        el('div', { class: 'choice-grid' }, Object.entries(q.education).map(([k, v]) => el('label', { class: 'choice' }, el('span', { class: 'check' }, el('input', { type: 'radio', name: 'education', value: k, required: true }), v.label))))),
      el('h2', { class: 'mt-l' }, 'Sở thích của em'),
      el('p', { class: 'muted small' }, 'Chọn mức độ đúng với em: 1 là không đúng, 5 là rất đúng.'),
      q.riasecItems.map((i) => likert(`r_${i.id}`, i.text)),
      el('h2', { class: 'mt-l' }, 'Em học tốt môn nào?'),
      el('p', { class: 'muted small' }, 'Tự đánh giá, bỏ qua môn em không chắc: 1 là yếu, 5 là rất tốt.'),
      Object.entries(q.subjects).map(([k, v]) => likert(`s_${k}`, v, ['Yếu', 'Trung bình', 'Khá', 'Tốt', 'Rất tốt'])),
      el('h2', { class: 'mt-l' }, 'Mong muốn'),
      el('div', { class: 'form-grid' },
        el('label', {}, 'Hệ đào tạo muốn học', el('select', { name: 'desiredLevel' }, el('option', { value: 'ANY' }, 'Hệ nào cũng được'), Object.entries(q.levels).map(([k, v]) => el('option', { value: k }, v)))),
        el('label', {}, 'Môi trường làm việc thích nhất', el('select', { name: 'workStyle' }, el('option', { value: '' }, 'Chưa rõ'), Object.entries(q.workStyles).map(([k, v]) => el('option', { value: k }, v))))),
      el('label', { class: 'check' }, el('input', { type: 'checkbox', name: 'wantsTuitionSupport' }), el('span', {}, 'Em ưu tiên ngành có hỗ trợ học phí')),
      el('label', { class: 'check' }, el('input', { type: 'checkbox', name: 'wantsAbroad' }), el('span', {}, 'Em muốn học ngoại ngữ hoặc làm việc ở nước ngoài')),
      el('div', { class: 'btn-row' }, el('button', { type: 'submit', class: 'btn btn--tag' }, 'Xem ngành phù hợp'))));
  }

  function renderResult(r) {
    root.replaceChildren(
      el('h2', {}, 'Nhóm sở thích của em'),
      el('div', { class: 'riasec' }, Object.entries(r.riasec).map(([k, v]) => el('div', {}, el('strong', {}, String(v)), r.riasecLabels[k]))),
      el('h2', { class: 'mt-l' }, `${r.results.length} ngành phù hợp nhất`),
      r.explanation ? el('p', { class: 'lede' }, r.explanation) : null,
      r.results.length ? r.results.map((x, i) => el('article', { class: 'result' },
        el('div', { class: 'result-rank' }, String(i + 1)),
        el('div', {},
          el('h3', {}, el('a', { href: `/nganh-chi-tiet.html?code=${encodeURIComponent(x.majorCode)}` }, x.name)),
          el('p', { class: 'small muted mb-0' }, `Khoa ${x.faculty} · Hệ phù hợp: ${x.levels.map((l) => LEVEL_SHORT[l]).join(', ')} · Điểm phù hợp ${x.score}/100`),
          el('div', { class: 'bars' }, Object.entries(x.parts).map(([k, v]) => {
            const fill = el('span');
            fill.style.width = `${v}%`;
            return el('div', { class: 'bar' }, el('span', {}, PART_LABEL[k]), el('span', { class: 'bar-track' }, fill), el('span', {}, `${v}%`));
          })),
          el('ul', { class: 'small' }, x.reasons.map((t) => el('li', {}, t))),
          el('div', { class: 'btn-row' },
            el('button', { class: 'btn btn--sm', 'data-action': 'ask', 'data-question': `Ngành ${x.name} học những gì, ra trường làm gì?`, 'data-major': x.majorCode }, 'Hỏi thêm về ngành này'),
            el('a', { class: 'btn btn--sm btn--ghost', href: `/ho-so.html` }, 'Chuẩn bị hồ sơ')))))
        : el('p', { class: 'note' }, 'Chưa tìm được ngành phù hợp với lựa chọn hệ đào tạo. Thử chọn "Hệ nào cũng được".'),
      el('p', { class: 'note small mt-m' }, 'Kết quả mang tính tham khảo, tính theo mô hình sở thích nghề nghiệp Holland (RIASEC). Hồ sơ nghề của từng ngành đang được cán bộ tư vấn hoàn thiện; hãy trao đổi thêm với thầy cô trước khi quyết định.'),
      el('div', { class: 'btn-row mt-m' }, el('button', { class: 'btn', 'data-action': 'restart' }, 'Làm lại')));
    root.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  let questionnaire;
  actionDelegate.register({
    async 'submit-quiz'(form) {
      const fd = new FormData(form);
      const answers = { education: fd.get('education'), riasec: {}, subjects: {}, preferences: {} };
      for (const i of questionnaire.riasecItems) {
        const v = fd.get(`r_${i.id}`);
        if (!v) { toast('Em hãy trả lời đủ 18 câu về sở thích nhé.', 'error'); form.querySelector(`[name="r_${i.id}"]`).focus(); return; }
        answers.riasec[i.id] = Number(v);
      }
      for (const k of Object.keys(questionnaire.subjects)) if (fd.get(`s_${k}`)) answers.subjects[k] = Number(fd.get(`s_${k}`));
      answers.preferences = { desiredLevel: fd.get('desiredLevel'), workStyle: fd.get('workStyle') || undefined, wantsTuitionSupport: fd.get('wantsTuitionSupport') === 'on', wantsAbroad: fd.get('wantsAbroad') === 'on' };
      try { renderResult(await apiClient.post('/api/recommend', { answers })); } catch (e) { toast(e.message, 'error'); }
    },
    restart: () => renderForm(questionnaire),
  });
  apiClient.get('/api/recommend/questionnaire').then((q) => { questionnaire = q; renderForm(q); }).catch((e) => toast(e.message, 'error'));
})();
