/**
 * Tab Cài đặt AI (chỉ Quản trị hệ thống): bật/tắt AI, khóa API, mô hình và giới hạn, cách trả lời,
 * ngưỡng tìm kiếm, thử câu hỏi xem từng bước xử lý, lượng token 14 ngày.
 */
(function () {
  'use strict';
  const SOURCE_LABEL = { RULE: 'Câu trả lời cố định', FAQ: 'Câu hỏi thường gặp', RAG: 'Tài liệu tuyển sinh', CACHE: 'Bộ nhớ đệm', FALLBACK: 'Chưa có căn cứ', HANDOFF: 'Chuyển cán bộ', WEB: 'Tra cứu Internet' };
  const MODE_LABEL = { LLM: 'AI soạn', EXTRACTIVE: 'trích nguyên văn' };
  const MODEL_KEYS = ['LLM_MODEL', 'LLM_FALLBACK_MODEL', 'LLM_TEMPERATURE', 'LLM_TIMEOUT_SECONDS', 'MAX_ANSWER_TOKENS', 'MAX_HISTORY_TURNS', 'DAILY_TOKEN_BUDGET', 'EMBEDDING_MODEL', 'EMBEDDING_DIM'];
  const STYLE_KEYS = ['AI_ASSISTANT_NAME', 'AI_TONE', 'AI_ANSWER_MAX_WORDS', 'CHAT_GREETING', 'AI_EXTRA_INSTRUCTIONS', 'AI_WEB_SEARCH_ENABLED', 'KB_AUTO_PUBLISH', 'AI_RECOMMEND_EXPLAIN'];
  const nf = new Intl.NumberFormat('vi-VN');
  const pct = (x) => (x === null || x === undefined ? '—' : `${Math.round(x * 100)}%`);

  function section(title, lead, ...body) {
    return el('section', { class: 'panel settings' }, el('h3', { class: 'mb-0' }, title), lead ? el('p', { class: 'hint' }, lead) : null, body);
  }

  function settingsForm(id, rows, keys, { extraButtons = [] } = {}) {
    const byKey = new Map(rows.map((c) => [c.key, c]));
    return el('form', { class: 'settings-form', 'data-action': 'ai-save', id },
      keys.filter((k) => byKey.has(k)).map((k) => admin.configField(byKey.get(k))),
      el('div', { class: 'btn-row' }, el('button', { class: 'btn btn--primary', type: 'submit' }, 'Lưu thay đổi'), extraButtons));
  }

  function keyState(k) {
    if (k.undecryptable) return el('span', { class: 'badge badge--stop' }, 'Không giải mã được');
    if (!k.is_active) return el('span', { class: 'badge' }, 'Đang tắt');
    if (k.pool?.coolingDownMs) return el('span', { class: 'badge badge--wait' }, `Tạm nghỉ ${Math.ceil(k.pool.coolingDownMs / 1000)} giây`);
    return el('span', { class: 'badge badge--go' }, 'Đang dùng');
  }

  function keysTable(s) {
    const rows = s.keys.map((k) => el('tr', {},
      el('td', {}, el('strong', {}, k.label), el('div', { class: 'small muted' }, `Thêm lúc ${admin.dt(k.created_at)}`)),
      el('td', {}, el('code', {}, k.key_hint)),
      el('td', {}, keyState(k)),
      el('td', { class: 'small' }, k.last_test_at ? [el('span', { class: k.last_test_ok ? 'ok-text' : 'stop-text' }, k.last_test_ok ? 'Tốt' : 'Lỗi'), ` · ${admin.dt(k.last_test_at)}`, el('div', { class: 'muted' }, k.last_test_message || '')] : el('span', { class: 'muted' }, 'Chưa kiểm tra')),
      el('td', {}, el('div', { class: 'btn-row' },
        el('button', { class: 'btn btn--sm', 'data-action': 'ai-key-test', 'data-id': k.id }, 'Kiểm tra'),
        el('button', { class: 'btn btn--sm', 'data-action': 'ai-key-toggle', 'data-id': k.id, 'data-active': String(k.is_active) }, k.is_active ? 'Tắt' : 'Bật'),
        el('button', { class: 'btn btn--sm', 'data-action': 'ai-key-rename', 'data-id': k.id, 'data-label': k.label }, 'Đổi tên'),
        el('button', { class: 'btn btn--sm btn--danger', 'data-action': 'ai-key-delete', 'data-id': k.id, 'data-label': k.label }, 'Xóa')))));
    const envRows = s.envKeys.map((k) => el('tr', { class: 'row-muted' },
      el('td', {}, el('strong', {}, k.label), el('div', { class: 'small muted' }, 'Khai báo trong tệp .env / biến môi trường')),
      el('td', {}, el('code', {}, '(ẩn)')),
      el('td', {}, k.coolingDownMs ? el('span', { class: 'badge badge--wait' }, `Tạm nghỉ ${Math.ceil(k.coolingDownMs / 1000)} giây`) : el('span', { class: 'badge badge--go' }, 'Đang dùng')),
      el('td', { class: 'small muted' }, k.failures ? `${k.failures} lần lỗi kể từ khi khởi động` : ''),
      el('td', { class: 'small muted' }, 'Sửa trong .env')));
    return admin.table(['Tên', 'Khóa', 'Trạng thái', 'Lần kiểm tra gần nhất', ''], [...rows, ...envRows], 'Chưa có khóa nào. Thêm khóa ở dưới để trợ lý dùng AI soạn câu trả lời.');
  }

  function usageChart(s) {
    const max = Math.max(1, s.budget, ...s.usage.map((d) => d.tokens));
    const bars = s.usage.map((d) => {
      const b = el('span', { title: `${hht.fmtDate(d.day)}: ${nf.format(d.tokens)} token, ${d.requests} lượt gọi` });
      b.style.height = `${Math.max(1, (d.tokens / max) * 100)}%`;
      return b;
    });
    return el('div', {},
      el('div', { class: 'spark' }, bars),
      el('div', { class: 'panel-head small muted' }, el('span', {}, hht.fmtDate(s.usage[0].day)), el('span', {}, 'hôm nay')));
  }

  function statusPanel(s) {
    const today = s.budget > 0 ? Math.min(100, (s.todayTokens / s.budget) * 100) : 100;
    const bar = el('span');
    bar.style.width = `${today}%`;
    const total = s.sources.reduce((n, x) => n + x.n, 0);
    const llmShare = s.sources.filter((x) => x.mode === 'LLM').reduce((n, x) => n + x.n, 0);
    const readyKeys = s.keys.filter((k) => k.is_active && !k.undecryptable).length + s.envKeys.length;
    let state;
    if (!s.enabled) state = el('p', { class: 'note' }, 'AI đang tắt. Trợ lý vẫn trả lời bằng câu hỏi thường gặp và trích nguyên văn tài liệu tuyển sinh.');
    else if (!readyKeys) state = el('p', { class: 'note' }, 'AI đang bật nhưng chưa có khóa API. Thêm khóa ở mục "Khóa API Gemini" để AI soạn câu trả lời.');
    else if (!s.available) state = el('p', { class: 'note' }, 'Tất cả khóa đang tạm nghỉ do hết hạn mức. Trợ lý tạm trích nguyên văn tài liệu và sẽ tự dùng lại AI khi khóa hồi.');
    else state = el('p', { class: 'note note--go' }, `AI đang hoạt động với mô hình ${s.model}${s.fallbackModel ? ` (dự phòng: ${s.fallbackModel})` : ''}, ${readyKeys} khóa sẵn sàng.`);
    return el('section', { class: 'panel' },
      el('div', { class: 'panel-head' }, el('h3', { class: 'mb-0' }, 'Tình trạng'),
        el('div', { class: 'btn-row' },
          el('button', { class: 'btn btn--sm', 'data-action': 'ai-test-all' }, 'Kiểm tra kết nối'),
          el('button', { class: `btn btn--sm ${s.enabled ? 'btn--danger' : 'btn--primary'}`, 'data-action': 'ai-toggle', 'data-enabled': String(s.enabled) }, s.enabled ? 'Tắt AI' : 'Bật AI'))),
      state,
      s.secretIsEphemeral ? el('p', { class: 'note note--stop' }, 'Máy chủ chưa đặt VISITOR_HASH_SECRET nên khóa API lưu ở đây sẽ không dùng được sau khi khởi động lại. Đặt biến này trong .env (hoặc trên Render) trước khi thêm khóa.') : null,
      el('div', { id: 'ai-test-result' }),
      el('div', { class: 'kpis mt-m' },
        el('div', { class: 'kpi' }, el('span', {}, 'Token hôm nay'), el('strong', {}, nf.format(s.todayTokens)), el('div', { class: 'progress mt-xs' }, bar), el('span', {}, s.budget ? `trên ngân sách ${nf.format(s.budget)}` : 'Ngân sách = 0: không dùng AI')),
        el('div', { class: 'kpi' }, el('span', {}, 'Câu trả lời 7 ngày qua'), el('strong', {}, nf.format(total)), el('span', {}, total ? `${Math.round((llmShare / total) * 100)}% do AI soạn` : 'chưa có lượt hỏi')),
        el('div', { class: 'kpi' }, el('span', {}, 'Bộ nhớ đệm'), el('strong', {}, nf.format(s.cache.entries)), el('span', {}, `${nf.format(s.cache.hits)} lần dùng lại`),
          el('div', { class: 'mt-xs' }, el('button', { class: 'btn btn--sm btn--ghost', 'data-action': 'ai-cache-clear' }, 'Xóa bộ nhớ đệm')))),
      el('h4', { class: 'mt-m mb-0' }, 'Token theo ngày (14 ngày)'),
      usageChart(s));
  }

  function traceView(r) {
    const t = r.trace || {};
    const steps = [];
    steps.push(['Câu trả lời cố định', t.rule ? 'Khớp (chào hỏi / ngoài phạm vi / xin gặp cán bộ)' : 'Không khớp']);
    if (t.faq) {
      steps.push(['Câu hỏi thường gặp', t.faq.matched ? `Khớp, độ giống ${pct(t.faq.score)}` : `Không đủ giống${t.faq.candidates.length ? `. Gần nhất: ${t.faq.candidates.map((c) => `"${c.question}" (${pct(c.score)})`).join('; ')}` : ''}`]);
    }
    if (t.retrieval) {
      steps.push(['Tài liệu tuyển sinh', `${t.retrieval.grounded ? 'Đủ căn cứ' : 'Không đủ căn cứ'}, điểm cao nhất ${pct(t.retrieval.topScore)}${t.vectorSearch ? ' (tìm theo nghĩa + từ khóa)' : ' (tìm theo từ khóa)'}`]);
    }
    if (t.llm) {
      let ai;
      if (!t.llm.enabled) ai = 'AI đang tắt';
      else if (!t.llm.keys) ai = 'Chưa có khóa API';
      else if (!t.llm.budgetOk) ai = 'Đã hết ngân sách token hôm nay';
      else if (!t.llm.used) ai = 'Không cần gọi AI ở câu này';
      else ai = `${t.llm.model || 'AI'}${t.llm.fallbackUsed ? ' (mô hình dự phòng)' : ''}: ${t.llm.accepted ? 'câu trả lời hợp lệ' : (t.llm.reason || 'không dùng được')}${t.llm.tokensIn ? `, ${nf.format(t.llm.tokensIn + t.llm.tokensOut)} token` : ''}`;
      steps.push(['AI soạn câu trả lời', ai]);
    }
    if (t.web) steps.push(['Tra cứu Internet', t.web.accepted ? `Dùng được, ${t.web.sources} nguồn web` : (t.web.reason || 'Không dùng được')]);
    return el('div', { class: 'try-result' },
      el('div', { class: 'btn-row' },
        el('span', { class: 'badge' }, SOURCE_LABEL[r.source] || r.source),
        r.answerMode ? el('span', { class: 'badge' }, MODE_LABEL[r.answerMode]) : null,
        el('span', { class: 'small muted' }, `${nf.format(r.latencyMs)} ms`)),
      el('div', { class: 'msg msg--bot mt-xs' }, r.answer),
      r.citations?.length ? el('p', { class: 'small muted' }, 'Nguồn: ', r.citations.map((c) => `[${c.n}] ${c.title}`).join('; ')) : null,
      el('h4', { class: 'mb-0' }, 'Các bước xử lý'),
      el('dl', { class: 'trace' }, steps.map(([k, v]) => [el('dt', {}, k), el('dd', {}, v)])),
      t.retrieval?.chunks?.length ? el('details', {}, el('summary', {}, `Xem ${t.retrieval.chunks.length} đoạn tài liệu đã tìm được`),
        el('ol', { class: 'small' }, t.retrieval.chunks.map((c) => el('li', {}, [c.title, c.heading].filter(Boolean).join(' › '), el('span', { class: 'muted' }, ` – giống nghĩa ${pct(c.cosine)}, trùng từ khóa ${pct(c.coverage)}`))))) : null);
  }

  admin.register({
    id: 'ai', title: 'Cài đặt AI', perm: 'CONFIG', events: [],
    async render(root) {
      const [s, configs] = await Promise.all([apiClient.get('/api/admin/ai/status'), admin.configs()]);
      const rag = configs.filter((c) => c.group === 'RAG').map((c) => c.key);
      root.replaceChildren(
        statusPanel(s),
        section('Khóa API Gemini', 'Trợ lý dùng lần lượt các khóa; khóa hết hạn mức sẽ tự nghỉ và chuyển sang khóa khác. Khóa được mã hóa trước khi lưu, sau khi lưu chỉ hiện 4 ký tự đầu và cuối.',
          keysTable(s),
          el('form', { class: 'form mt-m', 'data-action': 'ai-key-add' },
            el('h4', { class: 'mb-0' }, 'Thêm khóa'),
            el('div', { class: 'form-grid' },
              el('label', {}, 'Tên gợi nhớ', el('input', { name: 'label', required: true, maxlength: '60', placeholder: 'vd: Khóa tài khoản phòng Tuyển sinh' })),
              admin.passwordInput('apiKey', { label: 'Khóa API', autocomplete: 'off', strength: false })),
            el('p', { class: 'hint mb-0' }, 'Tạo khóa miễn phí tại Google AI Studio → Get API key (aistudio.google.com/apikey).'),
            el('div', { class: 'btn-row' },
              el('button', { class: 'btn btn--primary', type: 'submit' }, 'Kiểm tra và lưu'),
              el('button', { class: 'btn', type: 'button', 'data-action': 'ai-key-try' }, 'Chỉ kiểm tra')))),
        section('Mô hình và giới hạn', 'Thay đổi có hiệu lực ngay cho câu hỏi tiếp theo. Đổi mô hình vector hoặc số chiều sẽ tạo lại vector cho toàn bộ kho (chạy nền, mất vài phút).',
          settingsForm('ai-model-form', configs, MODEL_KEYS)),
        section('Cách trợ lý trả lời', 'Quy tắc chống bịa số liệu luôn được ưu tiên hơn hướng dẫn bổ sung, nên Nhà trường không thể vô tình cho phép AI đoán học phí hay ngày tháng.',
          settingsForm('ai-style-form', configs, STYLE_KEYS, { extraButtons: [el('button', { class: 'btn', type: 'button', 'data-action': 'ai-prompt-preview' }, 'Xem lời nhắc gửi AI')] }),
          el('pre', { class: 'chunk hidden', id: 'ai-prompt' })),
        section('Tìm kiếm tài liệu và câu hỏi thường gặp', 'Ngưỡng cao hơn thì trợ lý thận trọng hơn: ít trả lời sai nhưng chuyển cán bộ nhiều hơn. Dùng mục "Thử trợ lý" bên dưới để xem điểm thực tế trước khi chỉnh.',
          settingsForm('ai-rag-form', configs, rag)),
        section('Thử trợ lý', 'Chạy đúng quy trình trả lời như với thí sinh nhưng không lưu vào lịch sử hội thoại và không dùng bộ nhớ đệm.',
          el('form', { class: 'toolbar', 'data-action': 'ai-try' },
            el('label', { class: 'grow' }, 'Câu hỏi', el('input', { name: 'message', required: true, maxlength: '1000', placeholder: 'vd: Học phí ngành Điện tử công nghiệp bao nhiêu?' })),
            el('button', { class: 'btn btn--primary', type: 'submit' }, 'Hỏi thử')),
          el('div', { id: 'ai-try-result' })));
    },
  });

  async function confirmEmbeddingChange(form) {
    const touched = $$('[data-config="EMBEDDING_MODEL"], [data-config="EMBEDDING_DIM"]', form).some((i) => i.value.trim() !== i.dataset.initial);
    return !touched || confirmDialog('Đổi mô hình vector sẽ xóa vector cũ và tạo lại cho toàn bộ tài liệu, FAQ (tốn token). Trong lúc chạy, trợ lý tạm tìm theo từ khóa. Tiếp tục?', { okText: 'Đổi và tạo lại' });
  }

  actionDelegate.register({
    async 'ai-save'(form) {
      if (!(await confirmEmbeddingChange(form))) return;
      await admin.saveConfigs(form);
    },
    async 'ai-toggle'(b) {
      const on = b.dataset.enabled !== 'true';
      if (!on && !(await confirmDialog('Tắt AI? Trợ lý sẽ chỉ trả lời bằng câu hỏi thường gặp và trích nguyên văn tài liệu.', { okText: 'Tắt AI', danger: true }))) return;
      try { await apiClient.put('/api/admin/system/configs/AI_ENABLED', { value: String(on) }); toast(on ? 'Đã bật AI' : 'Đã tắt AI', 'ok'); admin.reload(); } catch (e) { toast(e.message, 'error'); }
    },
    async 'ai-test-all'() {
      const box = $('#ai-test-result');
      box.replaceChildren(el('p', { class: 'muted' }, 'Đang gửi câu hỏi thử tới từng khóa…'));
      try {
        const { results } = await apiClient.post('/api/admin/ai/test-connection', {});
        box.replaceChildren(results.length
          ? el('ul', { class: 'plain-list' }, results.map((r) => el('li', {}, el('strong', {}, r.label), ': ', el('span', { class: r.ok ? 'ok-text' : 'stop-text' }, r.message))))
          : el('p', { class: 'note' }, 'Chưa có khóa nào để kiểm tra.'));
      } catch (e) { box.replaceChildren(); toast(e.message, 'error'); }
    },
    async 'ai-cache-clear'() {
      if (!(await confirmDialog('Xóa toàn bộ câu trả lời đã lưu đệm? Nên làm sau khi sửa tài liệu hoặc đổi cách trả lời để thí sinh nhận câu trả lời mới.', { okText: 'Xóa bộ nhớ đệm' }))) return;
      try { const r = await apiClient.post('/api/admin/ai/cache/clear', {}); toast(`Đã xóa ${r.removed} câu trả lời đệm`, 'ok'); admin.reload(); } catch (e) { toast(e.message, 'error'); }
    },
    async 'ai-key-try'(b) {
      const form = b.closest('form');
      const apiKey = form.elements.apiKey.value.trim();
      if (!apiKey) { toast('Dán khóa API vào ô trước', 'error'); return; }
      try { const r = await apiClient.post('/api/admin/ai/keys/test', { apiKey }); toast(r.message, r.ok ? 'ok' : 'error'); } catch (e) { toast(e.message, 'error'); }
    },
    async 'ai-key-add'(form) {
      const d = Object.fromEntries(new FormData(form));
      try {
        const t = await apiClient.post('/api/admin/ai/keys/test', { apiKey: d.apiKey });
        if (!t.ok && !(await confirmDialog(`Khóa chưa dùng được: ${t.message}. Vẫn lưu khóa này?`, { okText: 'Vẫn lưu' }))) return;
        await apiClient.post('/api/admin/ai/keys', { label: d.label, apiKey: d.apiKey });
        toast('Đã thêm khóa, trợ lý dùng được ngay', 'ok');
        admin.reload();
      } catch (e) { toast(e.message, 'error'); }
    },
    async 'ai-key-test'(b) {
      b.textContent = 'Đang thử…';
      try { const r = await apiClient.post(`/api/admin/ai/keys/${b.dataset.id}/test`, {}); toast(r.message, r.ok ? 'ok' : 'error'); admin.reload(); } catch (e) { toast(e.message, 'error'); b.textContent = 'Kiểm tra'; }
    },
    'ai-key-toggle': (b) => apiClient.put(`/api/admin/ai/keys/${b.dataset.id}`, { isActive: b.dataset.active !== 'true' }).then(() => admin.reload()).catch((e) => toast(e.message, 'error')),
    async 'ai-key-rename'(b) {
      const r = await admin.formDialog({
        title: 'Đổi tên khóa', okText: 'Lưu',
        fields: [el('label', {}, 'Tên gợi nhớ', el('input', { name: 'label', value: b.dataset.label, required: true, maxlength: '60' }))],
        onSubmit: (d) => apiClient.put(`/api/admin/ai/keys/${b.dataset.id}`, { label: d.label }),
      });
      if (r) admin.reload();
    },
    async 'ai-key-delete'(b) {
      if (!(await confirmDialog(`Xóa khóa "${b.dataset.label}"? Không khôi phục được, muốn dùng lại phải dán lại khóa.`, { okText: 'Xóa khóa', danger: true }))) return;
      try { await apiClient.del(`/api/admin/ai/keys/${b.dataset.id}`); toast('Đã xóa khóa', 'ok'); admin.reload(); } catch (e) { toast(e.message, 'error'); }
    },
    async 'ai-prompt-preview'() {
      const pre = $('#ai-prompt');
      if (!pre.classList.contains('hidden')) { pre.classList.add('hidden'); return; }
      try { pre.textContent = (await apiClient.get('/api/admin/ai/prompt-preview')).prompt; pre.classList.remove('hidden'); } catch (e) { toast(e.message, 'error'); }
    },
    async 'ai-try'(form) {
      const box = $('#ai-try-result');
      box.replaceChildren(el('p', { class: 'muted' }, 'Đang xử lý…'));
      try { box.replaceChildren(traceView(await apiClient.post('/api/admin/ai/try', { message: form.elements.message.value }))); } catch (e) { box.replaceChildren(); toast(e.message, 'error'); }
    },
  });
})();
