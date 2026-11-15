(function () {
  'use strict';
  const STATUS = { BOOKED: ['Đã đặt', 'badge--wait'], CHECKED_IN: ['Đã đến', 'badge--go'], COMPLETED: ['Đã nộp', 'badge--go'], CANCELLED: ['Đã hủy', ''], NO_SHOW: ['Vắng', 'badge--stop'] };
  const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());

  admin.register({
    id: 'appointments', title: 'Lịch hẹn nộp hồ sơ', perm: 'APPOINTMENT_MANAGE',
    events: ['APPOINTMENT_BOOKED', 'APPOINTMENT_CANCELLED', 'APPOINTMENT_RESCHEDULED', 'APPOINTMENT_CHECKED_IN', 'APPOINTMENT_COMPLETED'],
    async render(root) {
      const date = root.dataset.apptDate || today();
      const [day, cal] = await Promise.all([apiClient.get(`/api/admin/appointments/day?date=${date}`), apiClient.get('/api/admin/appointments/calendar')]);
      const byDate = new Map();
      for (const s of cal.slots) {
        const d = byDate.get(s.slot_date) || { cap: 0, booked: 0, holiday: s.is_holiday };
        d.cap += s.is_closed ? 0 : s.capacity; d.booked += s.booked_count; byDate.set(s.slot_date, d);
      }
      root.replaceChildren(
        el('form', { class: 'toolbar', 'data-action': 'appt-checkin-code' },
          el('label', {}, 'Check-in bằng mã hẹn', el('input', { name: 'code', placeholder: 'HS-XXXX-XXXX', class: 'upper' })),
          el('button', { class: 'btn btn--sm btn--primary', type: 'submit' }, 'Tra cứu')),
        el('div', { id: 'appt-lookup' }),
        el('h3', {}, 'Công suất các ngày tới'),
        el('div', { class: 'choice-grid mb-m' }, [...byDate].map(([d, v]) => el('button', { class: 'choice', 'data-action': 'appt-day', 'data-value': d, 'aria-pressed': String(d === date) },
          `${hht.weekday(d)}, ${hht.fmtDate(d)}`, el('small', {}, v.holiday ? 'Ngày nghỉ' : `${v.booked}/${v.cap} lịch`)))),
        el('div', { class: 'grid-2' },
          el('section', {}, el('h3', {}, `Lịch hẹn ngày ${hht.fmtDate(date)}`),
            admin.table(['Giờ', 'Mã', 'Thí sinh', 'Giấy thiếu', 'Trạng thái', ''], day.appointments.map((a) => el('tr', {},
              el('td', {}, a.start_time), el('td', {}, a.code),
              el('td', { class: 'small' }, [a.contact_name, a.contact_phone].filter(Boolean).join(' · ') || '–', a.major_name ? el('div', { class: 'muted' }, a.major_name) : null),
              el('td', { class: 'small' }, (a.checklist_snapshot.missingMandatory || []).map((m) => m.title).join(', ') || 'Đủ'),
              el('td', {}, el('span', { class: `badge ${STATUS[a.status][1]}` }, STATUS[a.status][0])),
              el('td', {}, a.status === 'BOOKED' ? el('button', { class: 'btn btn--sm', 'data-action': 'appt-act', 'data-code': a.code, 'data-op': 'check-in' }, 'Check-in')
                : a.status === 'CHECKED_IN' ? el('button', { class: 'btn btn--sm btn--primary', 'data-action': 'appt-act', 'data-code': a.code, 'data-op': 'complete' }, 'Đã nhận hồ sơ') : null))), 'Chưa có lịch hẹn')),
          el('section', {}, el('h3', {}, 'Khung giờ'),
            admin.table(['Giờ', 'Đã đặt', 'Sức chứa', ''], day.slots.map((s) => el('tr', {},
              el('td', {}, `${s.start_time}–${s.end_time}`), el('td', {}, String(s.booked_count)),
              el('td', {}, el('input', { type: 'number', min: String(s.booked_count), max: '1000', value: String(s.capacity), 'data-slot': s.id, class: 'slot-cap' })),
              el('td', {}, el('button', { class: 'btn btn--sm', 'data-action': 'slot-toggle', 'data-id': s.id, 'data-closed': String(s.is_closed), 'data-booked': s.booked_count }, s.is_closed ? 'Mở lại' : 'Đóng khung')))), 'Ngày này không có khung giờ (ngày nghỉ hoặc chưa tạo)'),
            el('div', { class: 'btn-row mt-s' },
              el('button', { class: 'btn btn--sm', 'data-action': 'holiday', 'data-day': date }, 'Đặt làm ngày nghỉ'),
              el('button', { class: 'btn btn--sm btn--ghost', 'data-action': 'holiday-remove', 'data-day': date }, 'Bỏ ngày nghỉ'),
              el('button', { class: 'btn btn--sm btn--ghost', 'data-action': 'gen-slots' }, 'Tạo khung giờ còn thiếu')))));
      $$('.slot-cap', root).forEach((inp) => inp.addEventListener('change', () => apiClient.put(`/api/admin/appointments/slots/${inp.dataset.slot}`, { capacity: Number(inp.value) })
        .then(() => toast('Đã đổi sức chứa', 'ok')).catch((e) => { toast(e.message, 'error'); admin.reload(); })));
    },
  });

  const refresh = (msg) => () => { toast(msg, 'ok'); admin.reload(); };
  actionDelegate.register({
    'appt-day': (b) => { $('#tab').dataset.apptDate = b.dataset.value; admin.reload(); },
    async 'appt-checkin-code'(f) {
      try {
        const a = await apiClient.get(`/api/admin/appointments/lookup/${encodeURIComponent(f.code.value.trim())}`);
        $('#appt-lookup').replaceChildren(el('div', { class: 'panel mb-m' },
          el('strong', {}, `${a.code} · ${STATUS[a.status][0]}`),
          el('p', { class: 'small' }, `${hht.fmtDate(a.date)} ${a.startTime}–${a.endTime} · ${a.audienceLabel}${a.majorName ? ` · ${a.majorName}` : ''} · ${[a.contactName, a.contactPhone].filter(Boolean).join(' · ')}`),
          (a.checklist.missingMandatory || []).length ? el('p', { class: 'note note--stop small' }, `Thiếu: ${a.checklist.missingMandatory.map((m) => m.title).join(', ')}`) : null,
          a.status === 'BOOKED' ? el('button', { class: 'btn btn--primary btn--sm', 'data-action': 'appt-act', 'data-code': a.code, 'data-op': 'check-in' }, 'Check-in') : null,
          a.status === 'CHECKED_IN' ? el('button', { class: 'btn btn--primary btn--sm', 'data-action': 'appt-act', 'data-code': a.code, 'data-op': 'complete' }, 'Đã nhận hồ sơ') : null));
      } catch (e) { toast(e.message, 'error'); }
    },
    'appt-act': (b) => apiClient.post(`/api/admin/appointments/${b.dataset.code}/${b.dataset.op}`, {}).then(refresh('Đã cập nhật')).catch((e) => toast(e.message, 'error')),
    async 'slot-toggle'(b) {
      const closing = b.dataset.closed !== 'true';
      if (closing && Number(b.dataset.booked) > 0 && !(await confirmDialog(`Khung này đã có ${b.dataset.booked} lịch hẹn. Đóng khung không hủy các lịch đó – cần liên hệ thí sinh để đổi lịch. Tiếp tục?`, { okText: 'Đóng khung', danger: true }))) return;
      apiClient.put(`/api/admin/appointments/slots/${b.dataset.id}`, { isClosed: closing }).then(refresh(closing ? 'Đã đóng khung' : 'Đã mở lại')).catch((e) => toast(e.message, 'error'));
    },
    async holiday(b) {
      if (!(await confirmDialog(`Đặt ngày ${hht.fmtDate(b.dataset.day)} là ngày nghỉ? Thí sinh sẽ không đặt được lịch mới ngày này.`, { okText: 'Đặt ngày nghỉ' }))) return;
      const r = await apiClient.post('/api/admin/appointments/holidays', { day: b.dataset.day, reason: 'Nghỉ' }).catch((e) => { toast(e.message, 'error'); });
      if (r) { toast(r.affectedBookings ? `Đã đặt ngày nghỉ. ${r.affectedBookings} lịch đã đặt cần liên hệ đổi.` : 'Đã đặt ngày nghỉ', 'ok'); admin.reload(); }
    },
    'holiday-remove': (b) => apiClient.post('/api/admin/appointments/holidays', { day: b.dataset.day, remove: true }).then(refresh('Đã bỏ ngày nghỉ')).catch((e) => toast(e.message, 'error')),
    'gen-slots': () => apiClient.post('/api/admin/appointments/generate-slots', {}).then((r) => { toast(`Đã tạo ${r.created} khung`, 'ok'); admin.reload(); }).catch((e) => toast(e.message, 'error')),
  });
})();
