'use strict';
/**
 * Hàng việc nền bền vững: setInterval 5s, lấy việc bằng FOR UPDATE SKIP LOCKED, tối đa 3 lần thử,
 * backoff 30s × 2^n. Trạng thái nằm trong DB nên restart không mất việc; việc RUNNING bị bỏ dở
 * (bản chạy chết) được trả lại hàng đợi sau JOB_STALE_SECONDS.
 */
const jobRepository = require('../repositories/jobRepository');

const JOB_POLL_INTERVAL_MS = 5_000;
const JOB_BACKOFF_BASE_SECONDS = 30;
const JOB_STALE_SECONDS = 15 * 60;

function createJobRunner({ db, handlers, workerId, broadcast = () => {}, logger = console }) {
  let timer = null;
  let busy = false;
  let lastStaleCheck = 0;

  async function runOnce() {
    if (busy) return 0;
    busy = true;
    let done = 0;
    try {
      if (Date.now() - lastStaleCheck > 60_000) {
        lastStaleCheck = Date.now();
        await jobRepository.requeueStale(db, JOB_STALE_SECONDS);
      }
      for (;;) {
        const job = await jobRepository.claimNext(db, workerId);
        if (!job) break;
        const handler = handlers[job.type];
        try {
          if (!handler) throw new Error(`Chưa có xử lý cho loại việc ${job.type}`);
          const result = await handler(job.payload, job);
          await jobRepository.complete(db, job.id, result);
          broadcast('JOB_UPDATED', { id: Number(job.id), type: job.type, status: 'DONE' });
        } catch (err) {
          const final = await jobRepository.fail(db, job, err.message, JOB_BACKOFF_BASE_SECONDS * 2 ** (job.attempts - 1));
          logger.warn(`[job] ${job.type}#${job.id} lỗi (lần ${job.attempts}${final ? ', dừng' : ''}):`, err.message);
          broadcast('JOB_UPDATED', { id: Number(job.id), type: job.type, status: final ? 'FAILED' : 'QUEUED' });
        }
        done += 1;
      }
    } catch (err) {
      logger.warn('[job] vòng lấy việc lỗi:', err.message);
    } finally {
      busy = false;
    }
    return done;
  }

  return {
    runOnce,
    start() {
      if (timer) return;
      runOnce();
      timer = setInterval(runOnce, JOB_POLL_INTERVAL_MS);
      timer.unref();
    },
    async stop() {
      clearInterval(timer);
      timer = null;
      while (busy) await new Promise((r) => setTimeout(r, 50));
    },
  };
}

module.exports = { createJobRunner, JOB_POLL_INTERVAL_MS };
