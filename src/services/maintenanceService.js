'use strict';
/** Job hằng đêm: phân loại tin nhắn còn trống intent; ẩn danh/xóa dữ liệu cũ theo DATA_RETENTION_DAYS. */
const chatRepository = require('../repositories/chatRepository');
const answerCacheRepository = require('../repositories/answerCacheRepository');

function createMaintenanceService({ db, configService, classifier }) {
  async function classifyMessages() {
    let total = 0;
    for (;;) {
      const batch = await chatRepository.listUnclassified(db, 200);
      if (!batch.length) break;
      for (const m of batch) await chatRepository.setClassification(db, m.id, classifier.classify(m.content));
      total += batch.length;
    }
    return { classified: total };
  }

  async function purgeOldData() {
    const days = configService.get('DATA_RETENTION_DAYS');
    const anonymized = await chatRepository.anonymizeOlderThan(db, days);
    // Liên hệ trong yêu cầu đã đóng: xóa SĐT/email sau thời hạn lưu trữ.
    const handoffs = await db.query(
      `UPDATE handoff_requests SET contact_phone = NULL, contact_email = '[đã xóa]', contact_name = NULL
        WHERE status IN ('ANSWERED','CLOSED') AND updated_at < now() - make_interval(days => ?) AND contact_email IS DISTINCT FROM '[đã xóa]'`,
      [days],
    );
    const appts = await db.query(
      `UPDATE appointments SET contact_phone = NULL, contact_email = NULL, contact_name = NULL
        WHERE status IN ('COMPLETED','CANCELLED','NO_SHOW') AND updated_at < now() - make_interval(days => ?) AND (contact_phone IS NOT NULL OR contact_email IS NOT NULL)`,
      [days],
    );
    const cache = await answerCacheRepository.purgeExpired(db);
    const jobs = await db.query("DELETE FROM jobs WHERE status = 'DONE' AND updated_at < now() - interval '30 days'");
    return { anonymized, handoffs: handoffs.rowCount, appointments: appts.rowCount, cache, jobs: jobs.rowCount };
  }

  return { classifyMessages, purgeOldData };
}

module.exports = { createMaintenanceService };
