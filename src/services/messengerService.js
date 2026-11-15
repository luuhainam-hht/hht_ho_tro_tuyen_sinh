'use strict';
/**
 * Kênh Fanpage Messenger (bật bằng MESSENGER_ENABLED). Webhook:
 *   GET  xác minh hub.verify_token
 *   POST kiểm tra chữ ký X-Hub-Signature-256 (HMAC-SHA256 trên RAW body bằng App Secret)
 * Trả lời qua Send API sau khi đã phản hồi 200 cho Meta (Meta yêu cầu phản hồi nhanh).
 */
const crypto = require('node:crypto');
const { hmac, sha256, uuid } = require('../utils/crypto');
const chatRepository = require('../repositories/chatRepository');

const GRAPH_URL = 'https://graph.facebook.com/v19.0/me/messages';
const MESSENGER_MAX_CHARS = 1900;

function verifySignature(rawBody, header, appSecret) {
  if (!appSecret || !header || !rawBody) return false;
  const expected = `sha256=${hmac(appSecret, rawBody)}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(String(header));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function formatForMessenger(reply) {
  let text = reply.answer;
  const links = (reply.citations || []).filter((c) => c.url).slice(0, 2).map((c) => `• ${c.title}: ${c.url}`);
  if (links.length) text += `\n\nNguồn:\n${links.join('\n')}`;
  return text.length > MESSENGER_MAX_CHARS ? `${text.slice(0, MESSENGER_MAX_CHARS)}…` : text;
}

function createMessengerService({ db, configService, answerService, env, fetchImpl = fetch, logger = console }) {
  async function send(psid, text) {
    if (!env.MESSENGER_PAGE_TOKEN) return;
    const res = await fetchImpl(`${GRAPH_URL}?access_token=${encodeURIComponent(env.MESSENGER_PAGE_TOKEN)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient: { id: psid }, messaging_type: 'RESPONSE', message: { text } }),
    });
    if (!res.ok) logger.warn('[messenger] Send API lỗi:', res.status);
  }

  async function handleEvent(event) {
    const text = event.message?.text;
    const psid = event.sender?.id;
    if (!text || !psid || event.message?.is_echo) return;
    const session = await chatRepository.createSession(db, { id: uuid(), channel: 'FANPAGE', visitorHash: null, externalRef: sha256(`fb:${psid}`) });
    const reply = await answerService.answer({ sessionId: session.id, message: text });
    await send(psid, formatForMessenger(reply));
  }

  /** Gọi sau khi đã trả 200; mọi lỗi chỉ ghi log. */
  async function process(body) {
    if (!configService.get('MESSENGER_ENABLED') || body?.object !== 'page') return;
    for (const entry of body.entry || []) {
      for (const ev of entry.messaging || []) {
        try { await handleEvent(ev); } catch (err) { logger.warn('[messenger] xử lý tin nhắn lỗi:', err.message); }
      }
    }
  }

  return { verifySignature: (raw, header) => verifySignature(raw, header, env.MESSENGER_APP_SECRET), process };
}

module.exports = { createMessengerService, verifySignature, formatForMessenger };
