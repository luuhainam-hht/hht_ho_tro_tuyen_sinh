'use strict';
/**
 * Transport LLM giả cho test: embed tất định (bag-of-words băm vào 64 chiều) để thử nhánh vector;
 * generate trả JSON do test quyết định qua hàm responder.
 */
const { keywords } = require('../../src/utils/textNormalize');

const DIM = 64;
function hashVec(text) {
  const v = new Array(DIM).fill(0);
  for (const t of keywords(text)) {
    let h = 0;
    for (const ch of t) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    v[h % DIM] += 1;
  }
  return v;
}

function createFakeTransport({ responder = () => ({ answer: 'Chưa có thông tin.', citations: [], insufficient: true }), failKeys = new Set() } = {}) {
  const calls = { generate: 0, embed: 0, keysUsed: [] };
  return {
    calls,
    async generate(key, req) {
      calls.generate += 1;
      calls.keysUsed.push(key);
      if (failKeys.has(key)) throw Object.assign(new Error('RESOURCE_EXHAUSTED quota'), { status: 429 });
      const body = responder(req);
      // Chế độ tra cứu Internet: responder trả { text, webSources } (giả lập groundingMetadata của Gemini).
      if (req.search && body && typeof body === 'object' && 'webSources' in body) {
        return { text: body.text, webSources: body.webSources, tokensIn: 150, tokensOut: 60 };
      }
      return { text: typeof body === 'string' ? body : JSON.stringify(body), tokensIn: 120, tokensOut: 40 };
    },
    async embed(key, { texts }) {
      calls.embed += 1;
      return texts.map(hashVec);
    },
  };
}

module.exports = { createFakeTransport, hashVec };
