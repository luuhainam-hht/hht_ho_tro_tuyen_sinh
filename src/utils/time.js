'use strict';
/**
 * Mọi giờ nghiệp vụ theo Asia/Ho_Chi_Minh bằng Intl. KHÔNG dùng getHours()/getDay():
 * Render, Docker chạy UTC -> lệch 7 giờ (bản gốc từng purge giữa giờ làm việc vì lỗi này).
 */
const BUSINESS_TIME_ZONE = 'Asia/Ho_Chi_Minh';
const VN_OFFSET_MS = 7 * 60 * 60 * 1000; // Việt Nam không có giờ mùa hè -> offset cố định

const FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short', hourCycle: 'h23',
});
const WEEKDAY = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

/** @returns {{date:string, hour:number, minute:number, isoWeekday:number, minutesOfDay:number}} */
function vnClock(at = new Date()) {
  const p = Object.fromEntries(FORMATTER.formatToParts(at).map((x) => [x.type, x.value]));
  const hour = Number(p.hour);
  const minute = Number(p.minute);
  return { date: `${p.year}-${p.month}-${p.day}`, hour, minute, isoWeekday: WEEKDAY[p.weekday], minutesOfDay: hour * 60 + minute };
}

const vnToday = (at = new Date()) => vnClock(at).date;

/** 'YYYY-MM-DD' + n ngày (tính trên lịch, không phụ thuộc TZ máy). */
function addDays(isoDate, n) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function isoWeekdayOf(isoDate) {
  const day = new Date(`${isoDate}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

const parseTime = (hhmm) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm));
  if (!m) throw new Error(`Giờ không hợp lệ: ${hhmm}`);
  return Number(m[1]) * 60 + Number(m[2]);
};
const formatTime = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/** Thời điểm tuyệt đối (Date) của "ngày + giờ" theo giờ Việt Nam. */
function vnDateTime(isoDate, hhmm) {
  return new Date(Date.parse(`${isoDate}T00:00:00Z`) + parseTime(hhmm) * 60_000 - VN_OFFSET_MS);
}

module.exports = { BUSINESS_TIME_ZONE, vnClock, vnToday, addDays, isoWeekdayOf, parseTime, formatTime, vnDateTime };
