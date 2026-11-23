(function () {
  'use strict';
  const { fmtDate, weekday, params } = hht;
  const state = { step: 0, audience: params().get('audience') || 'CHINH_QUY', majorCode: params().get('major') || '', items: [], confirmed: new Set(), days: [], day: null, slotId: null };
  const root = $('#booking');

  function stepper() {
    $$('#stepper li').forEach((li, i) => {
      li.classList.toggle('done', i < state.step);
      if (i === state.step) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
    });
  }

  async function loadChecklist() {
    const res = await apiClient.post('/api/appointments/checklist/evaluate', { audience: state.audience, confirmedDocCodes: [...state.confirmed] });
    state.items = res.items;
    try {
      const saved = JSON.parse(localStorage.getItem('hht.checklist') || '{}')[state.audience] || [];
      if (!state.confirmed.size) saved.forEach((c) => state.confirmed.add(c));
    } catch { /* bỏ qua */ }
  }

  async function step1() {
    const meta = await hht.meta();
    await loadChecklist();
    const majors = (await apiClient.get('/api/handbook/majors')).majors;
    root.replaceChildren(el('div', { class: 'form' },
      el('fieldset', {}, el('legend', {}, 'Bạn nộp hồ sơ theo đối tượng nào?'),
        el('div', { class: 'choice-grid' }, Object.entries(meta.audiences).map(([k, v]) => el('button', { type: 'button', class: 'choice', 'data-action': 'audience', 'data-value': k, 'aria-pressed': String(k === state.audience) }, v)))),
      el('label', {}, 'Ngành dự định đăng ký (không bắt buộc)',
        el('select', { id: 'major' }, el('option', { value: '' }, 'Chưa chọn'), majors.map((m) => el('option', { value: m.code, selected: m.code === state.majorCode }, m.name)))),
      el('fieldset', {}, el('legend', {}, 'Giấy tờ bạn đã chuẩn bị'),
        el('ul', { class: 'doc-list', id: 'docs' }, state.items.map((i) => el('li', {}, el('label', { class: 'doc' },
          el('input', { type: 'checkbox', value: i.code, checked: state.confirmed.has(i.code) }),
          el('span', {}, el('strong', {}, i.title, ' ', el('span', { class: `badge ${i.is_mandatory ? 'badge--stop' : ''}` }, i.is_mandatory ? 'Bắt buộc' : 'Nếu thuộc diện')), el('span', { class: 'small' }, i.detail))))))),
      el('p', { class: 'small muted' }, 'Chưa đủ giấy vẫn đặt lịch được; danh sách còn thiếu sẽ hiện trên phiếu hẹn để bạn chuẩn bị.'),
      el('div', { class: 'btn-row' }, el('button', { class: 'btn btn--primary', 'data-action': 'next' }, 'Chọn ngày giờ'))));
    $('#docs').addEventListener('change', (e) => { if (e.target.checked) state.confirmed.add(e.target.value); else state.confirmed.delete(e.target.value); });
    $('#major').addEventListener('change', (e) => { state.majorCode = e.target.value; });
  }

  async function step2() {
    const res = await apiClient.get('/api/appointments/slots');
    state.days = res.days;
    if (!state.days.length) {
      root.replaceChildren(el('div', { class: 'note' }, 'Hiện chưa có khung giờ trống trong 14 ngày tới. Vui lòng quay lại sau hoặc gọi hotline.'),
        el('div', { class: 'btn-row mt-m' }, el('button', { class: 'btn', 'data-action': 'back' }, 'Quay lại')));
      return;
    }
    if (!state.day || !state.days.find((d) => d.date === state.day)) state.day = state.days[0].date;
    const day = state.days.find((d) => d.date === state.day);
    root.replaceChildren(el('div', { class: 'form' },
      el('fieldset', {}, el('legend', {}, 'Chọn ngày'),
        el('div', { class: 'choice-grid' }, state.days.map((d) => el('button', { type: 'button', class: 'choice', 'data-action': 'day', 'data-value': d.date, 'aria-pressed': String(d.date === state.day) },
          `${weekday(d.date)}, ${fmtDate(d.date)}`, el('small', {}, `Còn ${d.remaining} chỗ`))))),
      el('fieldset', {}, el('legend', {}, `Khung giờ ngày ${fmtDate(day.date)}`),
        el('div', { class: 'choice-grid' }, day.slots.map((s) => el('button', { type: 'button', class: 'choice', 'data-action': 'slot', 'data-value': s.id, 'aria-pressed': String(Number(s.id) === state.slotId), disabled: s.remaining <= 0 },
          `${s.start_time} – ${s.end_time}`, el('small', {}, s.remaining > 0 ? `Còn ${s.remaining} chỗ` : 'Hết chỗ'))))),
      el('div', { class: 'btn-row' }, el('button', { class: 'btn', 'data-action': 'back' }, 'Quay lại'), el('button', { class: 'btn btn--primary', 'data-action': 'next', disabled: !state.slotId }, 'Tiếp tục'))));
  }

  function step3() {
    const day = state.days.find((d) => d.date === state.day);
    const slot = day?.slots.find((s) => Number(s.id) === state.slotId);
    root.replaceChildren(el('form', { class: 'form', 'data-action': 'submit' },
      el('p', { class: 'note' }, `Lịch đã chọn: ${weekday(state.day)}, ${fmtDate(state.day)}, ${slot?.start_time} – ${slot?.end_time}.`),
      el('p', { class: 'small muted mb-0' }, 'Thông tin liên hệ không bắt buộc, chỉ dùng để nhắc lịch và giúp bạn lấy lại mã hẹn.'),
      el('div', { class: 'form-grid' },
        el('label', {}, 'Họ tên', el('input', { name: 'contactName', maxlength: '100', autocomplete: 'name' })),
        el('label', {}, 'Số điện thoại', el('input', { name: 'contactPhone', inputmode: 'tel', maxlength: '15', autocomplete: 'tel' })),
        el('label', {}, 'Email', el('input', { name: 'contactEmail', type: 'email', maxlength: '254', autocomplete: 'email' }))),
      el('label', { class: 'check' }, el('input', { type: 'checkbox', name: 'consent' }),
        el('span', {}, 'Tôi đồng ý để Nhà trường dùng thông tin liên hệ trên để nhắc lịch hẹn và hỗ trợ tuyển sinh.')),
      el('div', { class: 'btn-row' }, el('button', { type: 'button', class: 'btn', 'data-action': 'back' }, 'Quay lại'), el('button', { type: 'submit', class: 'btn btn--tag' }, 'Xác nhận đặt lịch'))));
  }

  function step4(a) {
    try { localStorage.setItem('hht.lastAppointment', a.code); } catch { /* bỏ qua */ }
    const missing = a.checklist?.missingMandatory || [];
    root.replaceChildren(el('div', { class: 'ticket ticket--qr' },
      el('div', { class: 'ticket-info' },
        el('p', { class: 'mb-0' }, 'Mã hẹn của bạn'),
        el('p', { class: 'ticket-code' }, a.code),
        el('p', { class: 'lede' }, `${weekday(a.date)}, ${fmtDate(a.date)} · ${a.startTime} – ${a.endTime}`),
        el('p', {}, a.address),
        el('p', { class: 'small muted' }, 'Đây không phải số thứ tự. Đến trong khung giờ, xuất trình mã hẹn hoặc mã QR tại bàn tiếp nhận. Hãy chụp màn hình hoặc bấm "Tải ảnh QR" để lưu lại.')),
      hhtQr.ticketQr(a)),
    missing.length ? el('div', { class: 'note note--stop mt-m' }, el('strong', {}, 'Giấy tờ bắt buộc còn thiếu:'), el('ul', {}, missing.map((m) => el('li', {}, m.title)))) : el('p', { class: 'note mt-m' }, 'Bạn đã khai đủ giấy tờ bắt buộc. Nhớ mang theo bản gốc để đối chiếu.'),
    el('div', { class: 'btn-row mt-m no-print' },
      el('a', { class: 'btn btn--primary', href: `/api/appointments/${a.code}/ics`, download: `lich-hen-${a.code}.ics` }, 'Thêm vào lịch điện thoại'),
      el('button', { class: 'btn', 'data-action': 'print' }, 'In phiếu hẹn'),
      el('a', { class: 'btn', href: `/hen.html?code=${a.code}` }, 'Tra cứu, đổi hoặc hủy lịch')));
  }

  async function render() {
    stepper();
    try {
      if (state.step === 0) await step1();
      else if (state.step === 1) await step2();
      else if (state.step === 2) step3();
    } catch (e) { toast(e.message, 'error'); }
  }

  actionDelegate.register({
    audience: async (b) => { state.audience = b.dataset.value; state.confirmed.clear(); await render(); },
    day: (b) => { state.day = b.dataset.value; state.slotId = null; return render(); },
    slot: (b) => { state.slotId = Number(b.dataset.value); return render(); },
    next: () => { state.step += 1; return render(); },
    back: () => { state.step -= 1; return render(); },
    async submit(form) {
      const f = Object.fromEntries(new FormData(form));
      try {
        const a = await apiClient.post('/api/appointments', {
          audience: state.audience, majorCode: state.majorCode || null, slotId: state.slotId, confirmedDocCodes: [...state.confirmed],
          contactName: f.contactName || null, contactPhone: f.contactPhone || null, contactEmail: f.contactEmail || null, consent: f.consent === 'on',
        });
        state.step = 3;
        stepper();
        step4(a);
        toast('Đã đặt lịch', 'ok');
      } catch (e) {
        toast(e.message, 'error');
        if (e.status === 409 && /hết chỗ|đã đóng|quá sát/.test(e.message)) { state.step = 1; state.slotId = null; render(); }
      }
    },
  });
  render();
})();
