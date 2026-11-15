(function () {
  'use strict';
  const { fmtDate, weekday, params } = hht;
  const STATUS = { BOOKED: ['Đã đặt', 'badge--wait'], CHECKED_IN: ['Đã đến trường', 'badge--go'], COMPLETED: ['Đã nộp hồ sơ', 'badge--go'], CANCELLED: ['Đã hủy', 'badge--stop'], NO_SHOW: ['Không đến', 'badge--stop'] };
  let current = null;

  function render(a) {
    current = a;
    const [label, cls] = STATUS[a.status];
    const missing = a.checklist?.missingMandatory || [];
    $('#appointment').replaceChildren(
      el('div', { class: 'ticket' }, el('span', { class: `badge ${cls}` }, label), el('p', { class: 'ticket-code' }, a.code),
        el('p', { class: 'lede' }, `${weekday(a.date)}, ${fmtDate(a.date)} · ${a.startTime} – ${a.endTime}`),
        el('p', {}, a.address), el('p', { class: 'small muted' }, `${a.audienceLabel}${a.majorName ? ` · ${a.majorName}` : ''}`)),
      missing.length ? el('div', { class: 'note note--stop mt-m' }, el('strong', {}, 'Giấy bắt buộc chưa khai có:'), el('ul', {}, missing.map((m) => el('li', {}, m.title)))) : null,
      a.status === 'BOOKED' ? el('div', { class: 'btn-row mt-m no-print' },
        el('a', { class: 'btn btn--primary', href: `/api/appointments/${a.code}/ics` }, 'Thêm vào lịch'),
        a.rescheduleLeft > 0 ? el('button', { class: 'btn', 'data-action': 'reschedule' }, `Đổi giờ (còn ${a.rescheduleLeft} lần)`) : null,
        el('button', { class: 'btn btn--danger', 'data-action': 'cancel' }, 'Hủy lịch'),
        el('button', { class: 'btn', 'data-action': 'print' }, 'In phiếu')) : null,
      el('div', { id: 'reschedule' }));
  }

  async function lookup(code) {
    try {
      render(await apiClient.get(`/api/appointments/${encodeURIComponent(code)}`));
      history.replaceState(null, '', `?code=${encodeURIComponent(current.code)}`);
    } catch (e) {
      $('#appointment').replaceChildren(el('p', { class: 'note note--stop' }, e.message));
    }
  }

  actionDelegate.register({
    lookup: (form) => lookup(form.code.value.trim()),
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

  let code = params().get('code');
  if (!code) { try { code = localStorage.getItem('hht.lastAppointment'); } catch { /* bỏ qua */ } }
  if (code) { $('#code').value = code; lookup(code); }
})();
