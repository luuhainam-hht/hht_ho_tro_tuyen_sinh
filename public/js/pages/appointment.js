(function () {
  'use strict';
  /**
   * Tra cứu lịch hẹn: nhập mã / quét QR / lấy lại mã bằng SĐT + ngày hẹn.
   * Kết quả: phiếu hẹn có QR, tiến trình hồ sơ, giấy tờ còn thiếu, lịch sử thay đổi, đổi giờ/hủy.
   */
  const { fmtDate, weekday, params } = hht;
  const STATUS = { BOOKED: ['Đã đặt', 'badge--wait'], CHECKED_IN: ['Đã đến trường', 'badge--go'], COMPLETED: ['Đã nộp hồ sơ', 'badge--go'], CANCELLED: ['Đã hủy', 'badge--stop'], NO_SHOW: ['Không đến', 'badge--stop'] };
  const EVENT_LABEL = {
    BOOKED: 'Đặt lịch, nhận mã hẹn', RESCHEDULED: 'Đổi sang khung giờ khác', CHECKED_IN: 'Đến trường, đã check-in tại bàn tiếp nhận',
    COMPLETED: 'Nhà trường đã nhận hồ sơ', CANCELLED: 'Hủy lịch hẹn', NO_SHOW: 'Không đến theo lịch hẹn',
  };
  const PROGRESS = [['BOOKED', 'Đã đặt lịch'], ['CHECKED_IN', 'Đến trường'], ['COMPLETED', 'Đã nộp hồ sơ']];
  const fmtTime = (iso) => (iso ? new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(iso)) : '');
  let current = null;

  function progress(a) {
    if (a.status === 'CANCELLED' || a.status === 'NO_SHOW') return null;
    const at = PROGRESS.findIndex(([s]) => s === a.status);
    return el('ol', { class: 'stepper mt-m', 'aria-label': 'Tiến trình hồ sơ' }, PROGRESS.map(([, label], i) => el('li', {
      class: i < at || (i === at && a.status === 'COMPLETED') ? 'done' : null, 'aria-current': i === at ? 'step' : null,
    }, label)));
  }

  function timeline(a) {
    if (!a.history?.length) return null;
    return el('section', { class: 'panel mt-m' }, el('h3', {}, 'Lịch sử lịch hẹn'),
      el('ol', { class: 'appt-history' }, a.history.map((h) => el('li', {},
        el('time', { datetime: h.at }, fmtTime(h.at)),
        el('span', {}, EVENT_LABEL[h.kind] || h.kind, h.byStaff && h.kind !== 'BOOKED' ? el('span', { class: 'muted' }, ' (cán bộ thực hiện)') : null)))));
  }

  function render(a) {
    current = a;
    const [label, cls] = STATUS[a.status];
    const missing = a.checklist?.missingMandatory || [];
    const active = a.status === 'BOOKED' || a.status === 'CHECKED_IN';
    $('#appointment').replaceChildren(
      el('div', { class: 'ticket ticket--qr' },
        el('div', { class: 'ticket-info' },
          el('span', { class: `badge ${cls}` }, label),
          el('p', { class: 'ticket-code' }, a.code),
          el('p', { class: 'lede' }, `${weekday(a.date)}, ${fmtDate(a.date)} · ${a.startTime} – ${a.endTime}`),
          el('dl', { class: 'ticket-meta' },
            el('dt', {}, 'Địa điểm'), el('dd', {}, a.address),
            el('dt', {}, 'Đối tượng'), el('dd', {}, a.audienceLabel),
            a.majorName ? [el('dt', {}, 'Ngành dự định'), el('dd', {}, a.majorName)] : null,
            a.contactName ? [el('dt', {}, 'Người đặt'), el('dd', {}, a.contactName)] : null,
            a.createdAt ? [el('dt', {}, 'Đặt lúc'), el('dd', {}, fmtTime(a.createdAt))] : null)),
        active ? hhtQr.ticketQr(a) : null),
      progress(a),
      a.status === 'BOOKED' ? (missing.length
        ? el('div', { class: 'note note--stop mt-m' }, el('strong', {}, 'Giấy bắt buộc chưa khai có:'), el('ul', {}, missing.map((m) => el('li', {}, m.title))))
        : el('p', { class: 'note mt-m' }, 'Bạn đã khai đủ giấy tờ bắt buộc. Nhớ mang theo bản gốc để đối chiếu.')) : null,
      a.status === 'BOOKED' ? el('div', { class: 'btn-row mt-m no-print' },
        el('a', { class: 'btn btn--primary', href: `/api/appointments/${a.code}/ics` }, 'Thêm vào lịch'),
        a.rescheduleLeft > 0 ? el('button', { class: 'btn', 'data-action': 'reschedule' }, `Đổi giờ (còn ${a.rescheduleLeft} lần)`) : null,
        el('button', { class: 'btn btn--danger', 'data-action': 'cancel' }, 'Hủy lịch'),
        el('button', { class: 'btn', 'data-action': 'print' }, 'In phiếu')) : null,
      el('div', { id: 'reschedule' }),
      timeline(a));
  }

  async function lookup(raw, { scroll = true } = {}) {
    const code = hhtQr.extractCode(raw);
    if (!code) { $('#appointment').replaceChildren(el('p', { class: 'note note--stop' }, 'Mã hẹn có dạng HS-XXXX-XXXX (8 ký tự sau chữ HS). Vui lòng kiểm tra lại.')); return; }
    $('#code').value = code;
    try {
      render(await apiClient.get(`/api/appointments/${encodeURIComponent(code)}`));
      history.replaceState(null, '', `?code=${encodeURIComponent(current.code)}`);
      try { localStorage.setItem('hht.lastAppointment', current.code); } catch { /* bỏ qua */ }
      if (scroll) $('#appointment').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) {
      $('#appointment').replaceChildren(el('p', { class: 'note note--stop' }, e.message));
    }
  }

  actionDelegate.register({
    lookup: (form) => lookup(form.code.value),
    async 'scan-qr'() {
      const code = await hhtQr.scan();
      if (code) lookup(code);
    },
    async recover(form) {
      const out = $('#recover-result');
      try {
        const r = await apiClient.post('/api/appointments/recover', { phone: form.phone.value.trim(), date: form.date.value });
        out.replaceChildren(el('p', { class: 'small mb-0' }, `Tìm thấy ${r.items.length} lịch hẹn:`),
          el('ul', { class: 'recover-list' }, r.items.map((i) => el('li', {},
            el('button', { class: 'btn btn--sm btn--primary', type: 'button', 'data-action': 'open-code', 'data-value': i.code }, i.code),
            el('span', {}, ` ${i.startTime} – ${i.endTime} · `), el('span', { class: `badge ${STATUS[i.status][1]}` }, STATUS[i.status][0])))));
      } catch (e) {
        out.replaceChildren(el('p', { class: 'note note--stop mb-0' }, e.message));
      }
    },
    'open-code': (b) => lookup(b.dataset.value),
    async cancel() {
      if (!(await confirmDialog(`Hủy lịch hẹn ${current.code}? Chỗ của bạn sẽ được nhường cho người khác.`, { okText: 'Hủy lịch', danger: true }))) return;
      try { render(await apiClient.post(`/api/appointments/${current.code}/cancel`)); toast('Đã hủy lịch', 'ok'); } catch (e) { toast(e.message, 'error'); }
    },
    async reschedule() {
      const { days } = await apiClient.get('/api/appointments/slots');
      $('#reschedule').replaceChildren(el('div', { class: 'panel mt-m' }, el('h3', {}, 'Chọn khung giờ mới'),
        days.length ? days.map((d) => el('div', { class: 'mt-s' }, el('strong', {}, `${weekday(d.date)}, ${fmtDate(d.date)}`),
          el('div', { class: 'choice-grid mt-xs' }, d.slots.filter((s) => s.remaining > 0).map((s) => el('button', { class: 'choice', 'data-action': 'pick-slot', 'data-value': s.id }, `${s.start_time} – ${s.end_time}`, el('small', {}, `Còn ${s.remaining} chỗ`))))))
          : el('p', {}, 'Không còn khung trống.')));
    },
    async 'pick-slot'(b) {
      try { render(await apiClient.post(`/api/appointments/${current.code}/reschedule`, { slotId: Number(b.dataset.value) })); toast('Đã đổi lịch', 'ok'); } catch (e) { toast(e.message, 'error'); }
    },
  });

  // Trang chủ dẫn tới /hen.html#quen-ma -> mở sẵn mục lấy lại mã
  if (location.hash === '#quen-ma') { $('#quen-ma').open = true; $('#quen-ma input[name=phone]').focus(); }
  let code = params().get('code');
  if (!code) { try { code = localStorage.getItem('hht.lastAppointment'); } catch { /* bỏ qua */ } }
  if (code) lookup(code, { scroll: false });
})();
