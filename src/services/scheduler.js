'use strict';
/**
 * Tác vụ định kỳ: setInterval 60s + pg_try_advisory_lock -> chỉ MỘT bản chạy thực thi.
 * Tác vụ hằng ngày không chạy trực tiếp mà ĐẨY job với dedupe_key theo ngày (giờ VN):
 * chạy đúng 1 lần/ngày dù nhiều bản chạy, và có retry/backoff của jobRunner.
 */
const { vnClock } = require('../utils/time');
const jobRepository = require('../repositories/jobRepository');

const SCHEDULER_INTERVAL_MS = 60_000;
const SCHEDULER_LOCK_KEY = 'hht_ts:scheduler';

/** [loại việc, giờ VN bắt đầu được chạy] */
const DAILY_JOBS = [
  ['GENERATE_SLOTS', 0],
  ['APPOINTMENT_NO_SHOW', 0],     // chạy sau nửa đêm: đánh dấu lịch của ngày hôm trước
  ['CLASSIFY_MESSAGES', 1],
  ['PURGE_OLD_DATA', 2],
];

function createScheduler({ db, tasks = {}, logger = console }) {
  let timer = null;
  let running = false;

  async function enqueueDaily(now = new Date()) {
    const clock = vnClock(now);
    let n = 0;
    for (const [type, hour] of DAILY_JOBS) {
      if (clock.hour < hour) continue;
      if (await jobRepository.enqueue(db, { type, dedupeKey: `${type}:${clock.date}` })) n += 1;
    }
    return n;
  }

  async function tick() {
    if (running) return;
    running = true;
    let client;
    try {
      client = await db.acquire();
      const { rows } = await client.query('SELECT pg_try_advisory_lock(hashtext(?)) AS ok', [SCHEDULER_LOCK_KEY]);
      if (!rows[0].ok) return;
      try {
        await enqueueDaily();
        for (const [name, task] of Object.entries(tasks)) {
          try { await task(); } catch (err) { logger.warn(`[scheduler] ${name} lỗi:`, err.message); }
        }
      } finally {
        await client.query('SELECT pg_advisory_unlock(hashtext(?))', [SCHEDULER_LOCK_KEY]).catch(() => {});
      }
    } catch (err) {
      logger.warn('[scheduler] bỏ qua lượt:', err.message);
    } finally {
      client?.release();
      running = false;
    }
  }

  return {
    tick,
    enqueueDaily,
    start() {
      if (timer) return;
      tick();
      timer = setInterval(tick, SCHEDULER_INTERVAL_MS);
      timer.unref();
    },
    async stop() {
      clearInterval(timer);
      timer = null;
      while (running) await new Promise((r) => setTimeout(r, 50));
    },
  };
}

module.exports = { createScheduler, DAILY_JOBS };
