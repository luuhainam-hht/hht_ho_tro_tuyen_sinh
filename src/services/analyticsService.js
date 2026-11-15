'use strict';
/**
 * M5 – Thống kê, phân tích nhu cầu thí sinh. Toàn bộ tính bằng SQL trên chat_messages,
 * handoff_requests, recommendation_sessions, appointments. Mốc ngày/giờ theo Asia/Ho_Chi_Minh.
 */
const ExcelJS = require('exceljs');
const { features, setCosine } = require('../utils/textNormalize');
const { vnToday, addDays } = require('../utils/time');
const { TOPICS } = require('../constants/catalog');

const TZ = "'Asia/Ho_Chi_Minh'";
const CLUSTER_SIMILARITY = 0.45;

/** Gom câu hỏi chưa trả lời được theo độ giống từ khóa (tham lam, đủ dùng cho vài trăm câu). */
function clusterQuestions(questions, threshold = CLUSTER_SIMILARITY) {
  const clusters = [];
  for (const q of questions) {
    const f = features(q.content);
    if (!f.size) continue;
    const hit = clusters.find((c) => setCosine(c.features, f) >= threshold);
    if (hit) { hit.count += 1; if (hit.examples.length < 3) hit.examples.push(q.content); } else clusters.push({ features: f, count: 1, representative: q.content, examples: [q.content] });
  }
  return clusters.sort((a, b) => b.count - a.count).map(({ features: _f, ...c }) => c);
}

function createAnalyticsService({ db, configService }) {
  function range({ from, to } = {}) {
    const today = vnToday();
    return { from: from || addDays(today, -29), to: to || today };
  }

  async function summary(opts) {
    const { from, to } = range(opts);
    const p = [from, to];
    const inRange = `(m.created_at AT TIME ZONE ${TZ})::date BETWEEN ?::date AND ?::date`;
    const [totals, sources, latency, ratings, sessions, byDay, byHour, topics, majors, tokens, handoff, recs, appts] = await Promise.all([
      db.query(`SELECT COUNT(*)::int AS questions FROM chat_messages m WHERE m.role = 'USER' AND ${inRange}`, p),
      db.query(`SELECT COALESCE(m.source,'?') AS source, COUNT(*)::int AS n FROM chat_messages m WHERE m.role = 'ASSISTANT' AND ${inRange} GROUP BY 1 ORDER BY 2 DESC`, p),
      db.query(`SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms)::int AS p50,
                       percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms)::int AS p95
                  FROM chat_messages m WHERE m.role = 'ASSISTANT' AND m.latency_ms IS NOT NULL AND ${inRange}`, p),
      db.query(`SELECT COUNT(*) FILTER (WHERE rating = 1)::int AS up, COUNT(*) FILTER (WHERE rating = -1)::int AS down
                  FROM chat_messages m WHERE m.role = 'ASSISTANT' AND ${inRange}`, p),
      db.query(`SELECT channel, COUNT(*)::int AS n FROM chat_sessions s WHERE (s.started_at AT TIME ZONE ${TZ})::date BETWEEN ?::date AND ?::date GROUP BY 1`, p),
      db.query(`SELECT to_char((m.created_at AT TIME ZONE ${TZ})::date, 'YYYY-MM-DD') AS day, s.channel, COUNT(*)::int AS n
                  FROM chat_messages m JOIN chat_sessions s ON s.id = m.session_id
                 WHERE m.role = 'USER' AND ${inRange} GROUP BY 1, 2 ORDER BY 1`, p),
      db.query(`SELECT EXTRACT(ISODOW FROM m.created_at AT TIME ZONE ${TZ})::int AS dow, EXTRACT(HOUR FROM m.created_at AT TIME ZONE ${TZ})::int AS hour, COUNT(*)::int AS n
                  FROM chat_messages m WHERE m.role = 'USER' AND ${inRange} GROUP BY 1, 2`, p),
      db.query(`SELECT t AS topic, COUNT(*)::int AS n FROM chat_messages m, unnest(m.topics) t WHERE m.role = 'USER' AND ${inRange} GROUP BY 1 ORDER BY 2 DESC LIMIT 15`, p),
      db.query(`SELECT mc AS code, mj.name, COUNT(*)::int AS n FROM chat_messages m, unnest(m.major_codes) mc LEFT JOIN majors mj ON mj.code = mc
                 WHERE m.role = 'USER' AND ${inRange} GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 15`, p),
      db.query('SELECT to_char(day, \'YYYY-MM-DD\') AS day, tokens_in, tokens_out, requests FROM token_usage_daily WHERE day BETWEEN ?::date AND ?::date ORDER BY day', p),
      db.query(`SELECT COUNT(*) FILTER (WHERE status IN ('NEW','ASSIGNED'))::int AS backlog,
                       COUNT(*) FILTER (WHERE status = 'NEW' AND created_at < now() - interval '24 hours')::int AS overdue,
                       ROUND(AVG(EXTRACT(EPOCH FROM (answered_at - created_at)) / 3600) FILTER (WHERE answered_at IS NOT NULL)::numeric, 1)::float AS avg_response_hours,
                       COUNT(*) FILTER (WHERE (created_at AT TIME ZONE ${TZ})::date BETWEEN ?::date AND ?::date)::int AS created
                  FROM handoff_requests`, p),
      db.query(`SELECT r->>'majorCode' AS code, mj.name, COUNT(*)::int AS n
                  FROM recommendation_sessions rs, jsonb_array_elements(rs.results) WITH ORDINALITY AS x(r, ord)
                  LEFT JOIN majors mj ON mj.code = r->>'majorCode'
                 WHERE x.ord = 1 AND (rs.created_at AT TIME ZONE ${TZ})::date BETWEEN ?::date AND ?::date GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 10`, p),
      db.query(`SELECT COUNT(*)::int AS total,
                       COUNT(*) FILTER (WHERE a.status IN ('CHECKED_IN','COMPLETED'))::int AS attended,
                       COUNT(*) FILTER (WHERE a.status = 'NO_SHOW')::int AS no_show,
                       COUNT(*) FILTER (WHERE a.status = 'CANCELLED')::int AS cancelled,
                       COUNT(*) FILTER (WHERE (a.checklist_snapshot->>'complete')::boolean)::int AS complete_checklist
                  FROM appointments a JOIN appointment_slots s ON s.id = a.slot_id WHERE s.slot_date BETWEEN ?::date AND ?::date`, p),
    ]);
    const srcTotal = sources.rows.reduce((s, r) => s + r.n, 0) || 1;
    return {
      range: { from, to },
      questions: totals.rows[0].questions,
      sessionsByChannel: sessions.rows,
      sourceShare: sources.rows.map((r) => ({ ...r, percent: Math.round((r.n / srcTotal) * 1000) / 10 })),
      latency: latency.rows[0],
      ratings: ratings.rows[0],
      byDay: byDay.rows,
      heatmap: byHour.rows,
      topTopics: topics.rows.map((r) => ({ ...r, label: TOPICS[r.topic] || r.topic })),
      topMajors: majors.rows,
      tokens: tokens.rows,
      dailyTokenBudget: configService.get('DAILY_TOKEN_BUDGET'),
      handoff: handoff.rows[0],
      recommendedMajors: recs.rows,
      appointments: appts.rows[0],
    };
  }

  async function unanswered(opts) {
    const { from, to } = range(opts);
    const { rows } = await db.query(
      `SELECT u.id, u.content, u.created_at FROM chat_messages u
        WHERE u.role = 'USER' AND (u.created_at AT TIME ZONE ${TZ})::date BETWEEN ?::date AND ?::date
          AND (SELECT a.source FROM chat_messages a WHERE a.session_id = u.session_id AND a.id > u.id AND a.role = 'ASSISTANT' ORDER BY a.id LIMIT 1) = 'FALLBACK'
        ORDER BY u.id DESC LIMIT 1000`,
      [from, to],
    );
    return { range: { from, to }, total: rows.length, clusters: clusterQuestions(rows).slice(0, 30) };
  }

  async function missingDocs(opts) {
    const { from, to } = range(opts);
    const { rows } = await db.query(
      `SELECT d->>'code' AS code, d->>'title' AS title, COUNT(*)::int AS n
         FROM appointments a JOIN appointment_slots s ON s.id = a.slot_id, jsonb_array_elements(a.checklist_snapshot->'missingMandatory') d
        WHERE s.slot_date BETWEEN ?::date AND ?::date GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 10`,
      [from, to],
    );
    return rows;
  }

  async function exportXlsx(opts) {
    const s = await summary(opts);
    const u = await unanswered(opts);
    const wb = new ExcelJS.Workbook();
    wb.creator = 'HHT Tuyển sinh AI';
    const sheet = (name, columns, rows) => {
      const ws = wb.addWorksheet(name);
      ws.columns = columns.map(([header, key, width = 18]) => ({ header, key, width }));
      ws.getRow(1).font = { bold: true };
      rows.forEach((r) => ws.addRow(r));
      return ws;
    };
    sheet('Tổng quan', [['Chỉ số', 'k', 42], ['Giá trị', 'v', 24]], [
      { k: 'Khoảng thời gian', v: `${s.range.from} → ${s.range.to}` },
      { k: 'Số câu hỏi', v: s.questions },
      ...s.sourceShare.map((x) => ({ k: `Tỉ lệ trả lời ${x.source} (%)`, v: x.percent })),
      { k: 'Độ trễ p50 (ms)', v: s.latency.p50 }, { k: 'Độ trễ p95 (ms)', v: s.latency.p95 },
      { k: 'Đánh giá hữu ích / chưa hữu ích', v: `${s.ratings.up} / ${s.ratings.down}` },
      { k: 'Câu hỏi chuyển cán bộ tồn đọng', v: s.handoff.backlog },
      { k: 'Thời gian phản hồi TB (giờ)', v: s.handoff.avg_response_hours },
      { k: 'Lịch hẹn nộp hồ sơ', v: s.appointments.total }, { k: 'Đến đúng hẹn', v: s.appointments.attended },
      { k: 'Vắng hẹn', v: s.appointments.no_show },
    ]);
    sheet('Theo ngày', [['Ngày', 'day'], ['Kênh', 'channel'], ['Số câu hỏi', 'n']], s.byDay);
    sheet('Chủ đề', [['Chủ đề', 'label', 30], ['Số lượt', 'n']], s.topTopics);
    sheet('Ngành được hỏi', [['Mã', 'code'], ['Ngành', 'name', 50], ['Số lượt', 'n']], s.topMajors);
    sheet('Ngành được gợi ý', [['Mã', 'code'], ['Ngành', 'name', 50], ['Số lần đứng đầu', 'n']], s.recommendedMajors);
    sheet('Chưa trả lời được', [['Câu hỏi đại diện', 'representative', 70], ['Số lượt', 'count']], u.clusters);
    sheet('Token', [['Ngày', 'day'], ['Token vào', 'tokens_in'], ['Token ra', 'tokens_out'], ['Số lượt gọi', 'requests']], s.tokens);
    return wb.xlsx.writeBuffer();
  }

  return { summary, unanswered, missingDocs, exportXlsx };
}

module.exports = { createAnalyticsService, clusterQuestions };
