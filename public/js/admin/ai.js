/**
 * Tab Cài đặt AI (chỉ Quản trị hệ thống) – cấu hình TOÀN BỘ AI tại một chỗ:
 * tình trạng, thống kê (Groq/Gemini theo ngày, theo việc, độ trễ, lỗi, tự chuyển bên, từng khóa, nguồn trả lời,
 * chi phí ước tính), phân việc cho từng nhà cung cấp, khóa API, mô hình, giới hạn & ngân sách, giá tham khảo,
 * cách trả lời, ngưỡng tìm kiếm, thử câu hỏi xem từng bước xử lý.
 */
(function () {
  'use strict';
  const SOURCE_LABEL = { RULE: 'Câu trả lời cố định', FAQ: 'Câu hỏi thường gặp', RAG: 'Tài liệu tuyển sinh', CACHE: 'Bộ nhớ đệm', FALLBACK: 'Chưa có căn cứ', HANDOFF: 'Chuyển cán bộ', WEB: 'Tra cứu Internet' };
  const MODE_LABEL = { LLM: 'AI soạn', EXTRACTIVE: 'trích nguyên văn' };
  const ROUTE_KEYS = ['AI_PROVIDER_CHAT', 'AI_PROVIDER_RECOMMEND', 'AI_PROVIDER_ANALYTICS'];
  const MODEL_KEYS = ['GROQ_MODEL', 'GROQ_FALLBACK_MODEL', 'GROQ_SMALL_MODEL', 'LLM_MODEL', 'LLM_FALLBACK_MODEL', 'EMBEDDING_MODEL', 'EMBEDDING_DIM'];
  const LIMIT_KEYS = ['DAILY_TOKEN_BUDGET', 'GROQ_DAILY_TOKEN_BUDGET', 'GEMINI_DAILY_TOKEN_BUDGET', 'MINDTEK_DAILY_TOKEN_BUDGET', 'LLM_TEMPERATURE', 'LLM_TIMEOUT_SECONDS', 'MAX_ANSWER_TOKENS', 'MAX_HISTORY_TURNS'];
  const PRICE_KEYS = ['PRICE_GROQ_IN', 'PRICE_GROQ_OUT', 'PRICE_GEMINI_IN', 'PRICE_GEMINI_OUT', 'PRICE_GEMINI_SEARCH_PER_1000', 'USD_VND_RATE'];
  const PROVIDER_NAME = { GROQ: 'Groq', GEMINI: 'Gemini', MINDTEK: 'Mindtek' };
  const PROVIDERS = ['GROQ', 'GEMINI', 'MINDTEK'];
  const MINDTEK_KEYS = ['MINDTEK_ENABLED', 'MINDTEK_BOT_ID', 'MINDTEK_BASE_URL', 'MINDTEK_TIMEOUT_SECONDS'];
  const TASK_LABEL = {
    CHAT: 'Trả lời chat', WEB_SEARCH: 'Tra Google', OCR: 'Đọc ảnh/PDF scan', RECOMMEND: 'Gợi ý ngành',
    ANALYTICS: 'Phân tích Tổng quan', EMBED: 'Vector (tìm theo nghĩa)', TEST: 'Kiểm tra khóa', OTHER: 'Khác',
  };
  const ERROR_LABEL = { RATE_LIMIT: 'Hết hạn mức / gọi quá nhanh', AUTH: 'Khóa sai / bị thu hồi', BAD_REQUEST: 'Yêu cầu sai / sai tên mô hình', SERVER: 'Máy chủ nhà cung cấp lỗi', NETWORK: 'Mạng / quá thời gian chờ', NO_KEY: 'Không còn khóa dùng được' };
  const usd = (x) => `$${(x || 0) < 0.01 && x > 0 ? (x || 0).toFixed(4) : (x || 0).toFixed(2)}`;
  let statsDays = 14;
  const STYLE_KEYS = ['AI_ASSISTANT_NAME', 'AI_TONE', 'AI_ANSWER_MAX_WORDS', 'CHAT_GREETING', 'AI_EXTRA_INSTRUCTIONS', 'AI_WEB_SEARCH_ENABLED', 'AI_OFFICIAL_SITE', 'AI_WEB_ALLOWED_DOMAINS', 'AI_WEB_GENERAL_ENABLED', 'KB_AUTO_PUBLISH', 'AI_OCR_ENABLED', 'AI_RECOMMEND_EXPLAIN'];
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
      el('td', {}, el('strong', {}, k.label), el('div', { class: 'small muted' }, `${k.provider === 'GROQ' ? 'Groq' : 'Gemini'} · thêm lúc ${admin.dt(k.created_at)}`)),
      el('td', {}, el('code', {}, k.key_hint)),
      el('td', {}, keyState(k)),
      el('td', { class: 'small' }, k.last_test_at ? [el('span', { class: k.last_test_ok ? 'ok-text' : 'stop-text' }, k.last_test_ok ? 'Tốt' : 'Lỗi'), ` · ${admin.dt(k.last_test_at)}`, el('div', { class: 'muted' }, k.last_test_message || '')] : el('span', { class: 'muted' }, 'Chưa kiểm tra')),
      el('td', {}, el('div', { class: 'btn-row' },
        el('button', { class: 'btn btn--sm', 'data-action': 'ai-key-test', 'data-id': k.id }, 'Kiểm tra'),
        el('button', { class: 'btn btn--sm', 'data-action': 'ai-key-toggle', 'data-id': k.id, 'data-active': String(k.is_active) }, k.is_active ? 'Tắt' : 'Bật'),
        el('button', { class: 'btn btn--sm', 'data-action': 'ai-key-rename', 'data-id': k.id, 'data-label': k.label }, 'Đổi tên'),
        el('button', { class: 'btn btn--sm btn--danger', 'data-action': 'ai-key-delete', 'data-id': k.id, 'data-label': k.label }, 'Xóa')))));
    const envRows = s.envKeys.map((k) => el('tr', { class: 'row-muted' },
      el('td', {}, el('strong', {}, k.label), el('div', { class: 'small muted' }, `${k.provider === 'GROQ' ? 'Groq' : 'Gemini'} – khai báo trong tệp .env / biến môi trường`)),
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
    else if (!readyKeys) state = el('p', { class: 'note' }, 'AI đang bật nhưng chưa có khóa API. Thêm khóa ở mục "Khóa API (Gemini, Groq)" để AI soạn câu trả lời.');
    else if (!s.available) state = el('p', { class: 'note' }, 'Tất cả khóa đang tạm nghỉ do hết hạn mức. Trợ lý tạm trích nguyên văn tài liệu và sẽ tự dùng lại AI khi khóa hồi.');
    else {
      const p = s.providers || {};
      const on = PROVIDERS.filter((pv) => p[pv.toLowerCase()]);
      const who = (pref) => {
        if (pref === 'BALANCE' && on.length > 1) return `chia đều ${on.map((pv) => PROVIDER_NAME[pv]).join(' + ')}`;
        if (on.includes(pref)) return PROVIDER_NAME[pref];
        return PROVIDER_NAME[on[0]] || '—';
      };
      state = el('p', { class: 'note note--go' },
        `AI đang hoạt động. Trả lời chat: ${who(p.chat)} · Gợi ý ngành: ${who(p.recommend)} · Phân tích Tổng quan: ${who(p.analytics)}`,
        on.length > 1 ? ' (lỗi tự chuyển bên còn lại). ' : '. ',
        p.gemini ? `Tra Google, vector, đọc ảnh/PDF: Gemini (${p.geminiKeys} khóa).` : 'Chưa có khóa Gemini nên chưa tra Google, tìm theo nghĩa và đọc ảnh/PDF scan được.',
        ` Groq: ${p.groqKeys || 0} khóa.`,
        p.mindtekConfigured ? ` Mindtek: ${p.mindtek ? 'sẵn sàng' : 'đang tạm nghỉ do lỗi'}.` : ' Mindtek: chưa bật.');
    }
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

  // ---------- Thống kê AI ----------
  function dualChart(st) {
    const tok = (d, pv) => d[pv].tokensIn + d[pv].tokensOut;
    const pvs = PROVIDERS.filter((pv) => st.daily[0]?.[pv]);
    const max = Math.max(1, ...st.daily.map((d) => pvs.reduce((n, pv) => n + tok(d, pv), 0)));
    const cols = st.daily.map((d) => {
      const col = el('span', { class: 'stack', title: [hht.fmtDate(d.day), ...pvs.map((pv) => `${PROVIDER_NAME[pv]}: ${nf.format(tok(d, pv))} token, ${d[pv].calls} lượt`)].join('\n') });
      for (const pv of [...pvs].reverse()) {
        const seg = el('i', { class: `seg seg--${pv.toLowerCase()}` });
        seg.style.height = `${(tok(d, pv) / max) * 100}%`;
        col.append(seg);
      }
      return col;
    });
    return el('div', {},
      el('div', { class: 'ai-legend small' }, pvs.map((pv) => el('span', {}, el('i', { class: `dot seg--${pv.toLowerCase()}` }), PROVIDER_NAME[pv]))),
      el('div', { class: 'spark spark--stack', role: 'img', 'aria-label': `Biểu đồ token theo ngày, tách ${pvs.map((pv) => PROVIDER_NAME[pv]).join(', ')}` }, cols),
      el('div', { class: 'panel-head small muted' }, el('span', {}, hht.fmtDate(st.from)), el('span', {}, 'hôm nay')));
  }

  function providerKpi(pv, s, today) {
    const used = today?.budget ? Math.min(100, (today.tokens / today.budget) * 100) : 0;
    const bar = el('span');
    bar.style.width = `${used}%`;
    return el('div', { class: `kpi kpi--${pv.toLowerCase()}` },
      el('span', {}, PROVIDER_NAME[pv]),
      el('strong', {}, `${nf.format(s.calls)} lượt`),
      el('dl', { class: 'kpi-dl small' },
        el('dt', {}, 'Token'), el('dd', {}, `${nf.format(s.tokensIn)} vào · ${nf.format(s.tokensOut)} ra`),
        el('dt', {}, 'Độ trễ'), el('dd', {}, s.calls ? `TB ${nf.format(s.avgMs)} ms · p95 ${nf.format(s.p95Ms)} ms` : '—'),
        el('dt', {}, 'Tỉ lệ lỗi'), el('dd', { class: s.errorRate > 10 ? 'stop-text' : '' }, `${s.errorRate}% (${nf.format(s.errors)} lỗi)`),
        el('dt', {}, 'Tự chuyển'), el('dd', {}, `${nf.format(s.fallbacks)} lần`),
        el('dt', {}, 'Hôm nay'), el('dd', {}, today?.budget ? `${nf.format(today.tokens)} / ${nf.format(today.budget)} token` : `${nf.format(today?.tokens || 0)} token (không giới hạn riêng)`)),
      today?.budget ? el('div', { class: 'progress mt-xs' }, bar) : null);
  }

  function taskTable(st) {
    const rows = st.tasks.map((t) => el('tr', {},
      el('td', {}, TASK_LABEL[t.task] || t.task),
      el('td', {}, el('span', { class: `badge badge--${t.provider.toLowerCase()}` }, PROVIDER_NAME[t.provider])),
      el('td', { class: 'num' }, nf.format(t.calls)),
      el('td', { class: 'num' }, nf.format(t.tokensIn + t.tokensOut)),
      el('td', { class: 'num' }, t.calls ? `${nf.format(t.avgMs)} / ${nf.format(t.p95Ms)}` : '—'),
      el('td', { class: `num ${t.errorRate > 10 ? 'stop-text' : ''}` }, `${t.errorRate}%`),
      el('td', { class: 'num' }, nf.format(t.fallbacks)),
      el('td', { class: 'num' }, usd(t.costUsd))));
    return admin.table(['Việc', 'Bên', 'Lượt gọi', 'Token', 'Độ trễ TB / p95 (ms)', 'Lỗi', 'Tự chuyển', 'Chi phí ước tính'], rows, 'Chưa có lượt gọi AI nào trong khoảng này.');
  }

  function keyStatsTable(st) {
    const rows = st.keys.map((k) => el('tr', {},
      el('td', {}, el('strong', {}, k.label), el('div', { class: 'small muted' }, `${PROVIDER_NAME[k.provider]} · ${k.source === 'ENV' ? '.env' : k.source === 'CONFIG' ? 'Bot ID trong mục Mindtek' : 'trang quản trị'}`)),
      el('td', { class: 'num' }, nf.format(k.calls)),
      el('td', { class: 'num' }, nf.format(k.successes)),
      el('td', { class: `num ${k.errors ? 'stop-text' : ''}` }, nf.format(k.errors)),
      el('td', {}, k.coolingDownMs ? el('span', { class: 'badge badge--wait' }, `Tạm nghỉ ${Math.ceil(k.coolingDownMs / 1000)} giây${k.lastError ? ` (${ERROR_LABEL[k.lastError] || k.lastError})` : ''}`) : el('span', { class: 'badge badge--go' }, 'Sẵn sàng')),
      el('td', { class: 'small muted' }, k.lastUsedAt ? admin.dt(k.lastUsedAt) : 'Chưa dùng')));
    return el('div', {},
      admin.table(['Khóa', 'Lượt gọi', 'Thành công', 'Lỗi', 'Trạng thái', 'Dùng gần nhất'], rows, 'Chưa có khóa nào.'),
      el('p', { class: 'hint' }, 'Số lượt của từng khóa đếm từ lần khởi động máy chủ gần nhất.'));
  }

  function sourceShare(st) {
    const total = st.sources.reduce((n, x) => n + x.n, 0);
    if (!total) return el('p', { class: 'muted' }, 'Chưa có câu trả lời nào trong khoảng này.');
    const groups = [
      ['Câu hỏi thường gặp', ['FAQ', 'RULE', 'CACHE']],
      ['Tài liệu tuyển sinh', ['RAG']],
      ['Tra Google', ['WEB']],
      ['Chưa trả lời được / chuyển cán bộ', ['FALLBACK', 'HANDOFF']],
    ];
    const n = (keys) => st.sources.filter((x) => keys.includes(x.source)).reduce((a, x) => a + x.n, 0);
    return el('div', { class: 'share' }, groups.map(([label, keys], i) => {
      const v = n(keys);
      const bar = el('span', { class: `share-bar share-bar--${i}` });
      bar.style.width = `${(v / total) * 100}%`;
      return el('div', { class: 'share-row' }, el('span', { class: 'share-label' }, label), el('div', { class: 'share-track' }, bar),
        el('span', { class: 'share-val' }, `${Math.round((v / total) * 100)}% · ${nf.format(v)}`));
    }), el('p', { class: 'hint' }, `Tổng ${nf.format(total)} câu trả lời. "Câu hỏi thường gặp" gồm câu trả lời cố định và bộ nhớ đệm – không tốn token.`));
  }

  function costPanel(st) {
    const c = st.cost;
    return el('div', {},
      el('div', { class: 'kpis' },
        el('div', { class: 'kpi' }, el('span', {}, `Chi phí ${st.days} ngày (ước tính)`), el('strong', {}, usd(c.totalUsd)), el('span', {}, `≈ ${nf.format(c.totalVnd)} đ`)),
        el('div', { class: 'kpi' }, el('span', {}, 'Dự kiến 30 ngày'), el('strong', {}, usd(c.monthlyUsd)), el('span', {}, `≈ ${nf.format(c.monthlyVnd)} đ`)),
        el('div', { class: 'kpi' }, el('span', {}, 'Tách theo bên'), el('strong', { class: 'kpi-sm' }, `Groq ${usd(c.groqUsd)} · Gemini ${usd(c.geminiUsd)} · Mindtek ${usd(c.mindtekUsd)}`),
          el('span', {}, `Tra Google: ${nf.format(c.searches)} lượt${c.paidSearches ? `, ${nf.format(c.paidSearches)} lượt tính phí (${usd(c.searchUsd)})` : ' (trong mức miễn phí 1.500/ngày)'}`))),
      el('p', { class: 'hint' }, 'Ước tính nếu dùng gói trả phí, theo giá ở mục "Giá tham khảo". Gói miễn phí hiện tại không mất tiền nhưng bị giới hạn số lượt/phút và token/ngày. Token vector được ước lượng theo độ dài văn bản.'));
  }

  function statsView(st) {
    const errRows = st.errors.map((e) => el('li', {}, `${PROVIDER_NAME[e.provider]}: ${ERROR_LABEL[e.kind] || e.kind} – ${nf.format(e.n)} lần`));
    return el('div', {},
      el('div', { class: 'kpis' }, PROVIDERS.filter((pv) => st.providers[pv]).map((pv) => providerKpi(pv, st.providers[pv], st.today[pv]))),
      el('h4', { class: 'mb-0' }, `Token theo ngày (${st.days} ngày)`),
      dualChart(st),
      el('h4', { class: 'mt-m mb-0' }, 'Theo từng việc'),
      taskTable(st),
      errRows.length ? [el('h4', { class: 'mt-m mb-0' }, 'Loại lỗi gặp nhiều'), el('ul', { class: 'small' }, errRows)] : null,
      el('h4', { class: 'mt-m mb-0' }, 'Tình trạng từng khóa'),
      keyStatsTable(st),
      el('h4', { class: 'mt-m mb-0' }, 'Nguồn câu trả lời cho thí sinh'),
      sourceShare(st),
      el('h4', { class: 'mt-m mb-0' }, 'Chi phí'),
      costPanel(st));
  }

  function statsSection() {
    return el('section', { class: 'panel' },
      el('div', { class: 'panel-head' }, el('h3', { class: 'mb-0' }, 'Thống kê AI'),
        el('div', { class: 'btn-row', role: 'group', 'aria-label': 'Khoảng thời gian' },
          [7, 14, 30].map((d) => el('button', { class: `btn btn--sm ${d === statsDays ? 'btn--primary' : ''}`, 'data-action': 'ai-stats-days', 'data-days': String(d), 'aria-pressed': String(d === statsDays) }, `${d} ngày`)),
          el('button', { class: 'btn btn--sm btn--ghost', 'data-action': 'ai-stats-days', 'data-days': String(statsDays) }, 'Làm mới'))),
      el('div', { id: 'ai-stats' }, el('p', { class: 'muted' }, 'Đang tải thống kê…')));
  }

  async function loadStats() {
    const box = $('#ai-stats');
    if (!box) return;
    try { box.replaceChildren(statsView(await apiClient.get(`/api/admin/ai/stats?days=${statsDays}`))); } catch (e) { box.replaceChildren(el('p', { class: 'note note--stop' }, e.message)); }
  }

  /** Bảng phân việc: 3 việc chọn được + các việc chỉ Gemini làm được. */
  function routingSection(configs) {
    const fixed = [
      ['Tra Google (website trường trước, câu hỏi chung)', 'Chỉ Gemini có Google Search'],
      ['Vector – tìm tài liệu theo nghĩa', 'Chỉ Gemini có mô hình vector'],
      ['Đọc ảnh, PDF scan, bảng chụp khi nạp tài liệu', 'Chỉ Gemini đọc được ảnh/PDF'],
    ];
    return section('Phân việc cho AI', 'Chọn nhà cung cấp chính cho từng việc (Groq, Gemini, Mindtek hoặc chia đều cả ba). Khi bên chính lỗi, hết hạn mức hoặc vượt ngân sách riêng, hệ thống tự chuyển lần lượt sang các bên còn lại. Thí sinh luôn dùng khung chat của HHT, không thấy bên nào đang trả lời.',
      settingsForm('ai-route-form', configs, ROUTE_KEYS),
      el('h4', { class: 'mt-m mb-0' }, 'Việc luôn do Gemini làm'),
      admin.table(['Việc', 'Lý do'], fixed.map(([a, b]) => el('tr', {}, el('td', {}, a), el('td', { class: 'small muted' }, b))), ''));
  }

  function traceView(r) {
    const t = r.trace || {};
    const steps = [];
    if (t.security?.blocked) steps.push(['Bảo mật', 'Câu hỏi dò thông tin nội bộ/bí mật – đã từ chối, không gửi cho AI']);
    if (t.security?.redacted) steps.push(['Bảo mật', 'Đã ẩn thông tin bí mật trong câu trả lời']);
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
      else ai = `${t.llm.provider ? `${PROVIDER_NAME[t.llm.provider] || t.llm.provider} – ` : ''}${t.llm.model || 'AI'}${t.llm.fallbackUsed ? ' (mô hình dự phòng)' : ''}: ${t.llm.accepted ? 'câu trả lời hợp lệ' : (t.llm.reason || 'không dùng được')}${t.llm.tokensIn ? `, ${nf.format(t.llm.tokensIn + t.llm.tokensOut)} token` : ''}`;
      steps.push(['AI soạn câu trả lời', ai]);
    }
    if (t.cache && !t.cache.enabled && t.cache.reason === 'HAS_HISTORY') steps.push(['Bộ nhớ đệm', 'Không dùng: câu hỏi nối tiếp trong cuộc trò chuyện']);
    if (t.web) {
      const extra = [
        t.web.rejectedSources ? `đã loại ${t.web.rejectedSources} nguồn ngoài tên miền cho phép` : '',
        t.web.droppedSentences ? `bỏ ${t.web.droppedSentences} câu có số liệu không có nguồn tin cậy` : '',
      ].filter(Boolean).join('; ');
      const main = t.web.accepted ? `Dùng được, ${t.web.sources} nguồn web${t.web.official ? ', có nguồn từ website chính thức' : ''}` : (t.web.reason || 'Không dùng được');
      steps.push([t.web.mode === 'GENERAL' ? 'Tra Google (câu hỏi chung)' : 'Tra Google (chỉ website được phép)', extra ? `${main} (${extra})` : main]);
    }
    return el('div', { class: 'try-result' },
      el('div', { class: 'btn-row' },
        el('span', { class: 'badge' }, SOURCE_LABEL[r.source] || r.source),
        r.answerMode ? el('span', { class: 'badge' }, MODE_LABEL[r.answerMode]) : null,
        el('span', { class: 'small muted' }, `${nf.format(r.latencyMs)} ms`)),
      el('div', { class: 'msg msg--bot mt-xs' }, r.answer),
      r.citations?.length ? el('p', { class: 'small muted' }, 'Nguồn: ', r.citations.map((c) => `[${c.n}] ${c.title}${c.official ? ' (chính thức)' : ''}`).join('; ')) : null,
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
        statsSection(),
        routingSection(configs),
        section('Khóa API (Gemini, Groq)', 'Khóa Groq (bắt đầu bằng gsk_) dùng để trả lời chat và phân tích – rất nhanh; khóa Gemini cần cho tra Google, tìm theo nghĩa và đọc ảnh/PDF scan. Trợ lý dùng lần lượt các khóa; khóa hết hạn mức sẽ tự nghỉ và chuyển sang khóa khác. Khóa được mã hóa trước khi lưu, sau khi lưu chỉ hiện 4 ký tự đầu và cuối.',
          keysTable(s),
          el('form', { class: 'form mt-m', 'data-action': 'ai-key-add' },
            el('h4', { class: 'mb-0' }, 'Thêm khóa'),
            el('div', { class: 'form-grid' },
              el('label', {}, 'Tên gợi nhớ', el('input', { name: 'label', required: true, maxlength: '60', placeholder: 'vd: Khóa tài khoản phòng Tuyển sinh' })),
              admin.passwordInput('apiKey', { label: 'Khóa API', autocomplete: 'off', strength: false })),
            el('p', { class: 'hint mb-0' }, 'Khóa Gemini: Google AI Studio → Get API key (aistudio.google.com/apikey). Khóa Groq: console.groq.com/keys. Hệ thống tự nhận loại khóa.'),
            el('div', { class: 'btn-row' },
              el('button', { class: 'btn btn--primary', type: 'submit' }, 'Kiểm tra và lưu'),
              el('button', { class: 'btn', type: 'button', 'data-action': 'ai-key-try' }, 'Chỉ kiểm tra')))),
        section('Mindtek (bot.mindtek.ai)', 'Mindtek là nhà cung cấp thứ 3: máy chủ HHT gửi câu hỏi kèm tài liệu tuyển sinh tới bot Mindtek rồi hiển thị câu trả lời trong khung chat của HHT (không nhúng giao diện Mindtek). Câu trả lời của Mindtek vẫn qua bước kiểm tra số liệu và trích dẫn như Groq/Gemini. Bot ID lấy ở Mindtek → Web Deployment → Display Inside Website (Embed): đoạn sau /embed/ trong mã nhúng.',
          settingsForm('ai-mindtek-form', configs, MINDTEK_KEYS, { extraButtons: [el('button', { class: 'btn', type: 'button', 'data-action': 'ai-test-all' }, 'Kiểm tra kết nối')] })),
        section('Mô hình', 'Tên mô hình của Groq và Gemini; có hiệu lực ngay cho câu hỏi tiếp theo. Nhà cung cấp ngừng mô hình nào thì đổi tên ở đây. Đổi mô hình vector hoặc số chiều sẽ tạo lại vector cho toàn bộ kho (chạy nền, mất vài phút).',
          settingsForm('ai-model-form', configs, MODEL_KEYS)),
        section('Giới hạn và ngân sách', 'Ngân sách chung hết thì trợ lý chỉ trả lời bằng câu hỏi thường gặp và trích nguyên văn tài liệu. Ngân sách riêng của một bên hết thì việc của bên đó chuyển sang bên còn lại.',
          settingsForm('ai-limit-form', configs, LIMIT_KEYS)),
        section('Giá tham khảo (ước tính chi phí)', 'Giá theo USD cho 1 triệu token, dùng để tính mục "Chi phí" ở phần Thống kê. Cập nhật khi nhà cung cấp đổi giá (groq.com/pricing, ai.google.dev/pricing).',
          settingsForm('ai-price-form', configs, PRICE_KEYS)),
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
      loadStats();
    },
  });

  async function confirmEmbeddingChange(form) {
    const touched = $$('[data-config="EMBEDDING_MODEL"], [data-config="EMBEDDING_DIM"]', form).some((i) => i.value.trim() !== i.dataset.initial);
    return !touched || confirmDialog('Đổi mô hình vector sẽ xóa vector cũ và tạo lại cho toàn bộ tài liệu, FAQ (tốn token). Trong lúc chạy, trợ lý tạm tìm theo từ khóa. Tiếp tục?', { okText: 'Đổi và tạo lại' });
  }

  actionDelegate.register({
    'ai-stats-days'(b) {
      statsDays = Number(b.dataset.days) || 14;
      $$('[data-action="ai-stats-days"][aria-pressed]').forEach((x) => { const on = Number(x.dataset.days) === statsDays; x.classList.toggle('btn--primary', on); x.setAttribute('aria-pressed', String(on)); });
      loadStats();
    },
    async 'ai-save'(form) {
      if (!(await confirmEmbeddingChange(form))) return;
      const n = await admin.saveConfigs(form);
      if (n > 0 && form.id === 'ai-price-form') loadStats();
      if (n > 0 && form.id === 'ai-route-form') admin.reload();
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
