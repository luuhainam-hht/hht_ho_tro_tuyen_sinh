'use strict';
/**
 * Hàm thuần: danh sách khung hẹn cho một ngày từ OFFICE_TIME_SLOTS (đã trừ nghỉ trưa vì là các dải
 * tách rời), bỏ ngày nghỉ lễ và ngày không làm việc.
 */
const { parseTimeSlots } = require('../../config/configService');
const { isoWeekdayOf, formatTime } = require('../../utils/time');

function plan(date, cfg, holidays = new Set()) {
  if (holidays.has(date)) return [];
  if (!cfg.workingDays.includes(isoWeekdayOf(date))) return [];
  const out = [];
  for (const r of parseTimeSlots(cfg.timeSlots)) {
    for (let t = r.start; t + cfg.slotMinutes <= r.end; t += cfg.slotMinutes) {
      out.push({ date, start: formatTime(t), end: formatTime(t + cfg.slotMinutes), capacity: cfg.capacity });
    }
  }
  return out;
}

module.exports = { plan };
