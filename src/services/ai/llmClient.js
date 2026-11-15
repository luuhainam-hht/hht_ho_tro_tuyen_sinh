'use strict';
/**
 * Cửa ngõ duy nhất tới LLM: sinh câu (generate) và tạo vector (embed) qua key pool, đếm token.
 * Tên model/số chiều đọc từ system_configs mỗi lần gọi -> đổi model qua Admin, không sửa mã.
 * transport có thể thay (test dùng bản giả; đổi nhà cung cấp chỉ viết transport mới).
 */
const { GoogleGenAI } = require('@google/genai');
const { createGeminiKeyPool } = require('./geminiKeyPool');

const LLM_TIMEOUT_MS = 20_000;
const EMBED_BATCH_SIZE = 50;

function createGeminiTransport() {
  const clients = new Map();
  const client = (apiKey) => {
    if (!clients.has(apiKey)) clients.set(apiKey, new GoogleGenAI({ apiKey }));
    return clients.get(apiKey);
  };
  return {
    async generate(apiKey, { model, system, contents, temperature, maxTokens, json }) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
      try {
        const res = await client(apiKey).models.generateContent({
          model,
          contents,
          config: {
            systemInstruction: system, temperature, maxOutputTokens: maxTokens, abortSignal: controller.signal,
            ...(json ? { responseMimeType: 'application/json' } : {}),
          },
        });
        const usage = res.usageMetadata || {};
        return { text: (res.text || '').trim(), tokensIn: usage.promptTokenCount || 0, tokensOut: usage.candidatesTokenCount || 0 };
      } finally {
        clearTimeout(timer);
      }
    },
    async embed(apiKey, { model, texts, dim, taskType }) {
      const res = await client(apiKey).models.embedContent({
        model, contents: texts, config: { outputDimensionality: dim, taskType },
      });
      return res.embeddings.map((e) => e.values);
    },
  };
}

function createLlmClient({ apiKeys, configService, transport = createGeminiTransport(), logger = console }) {
  const pool = createGeminiKeyPool(apiKeys, { logger });

  const available = () => pool.size > 0 && pool.available() > 0;

  async function generate({ system, history = [], prompt, json = false, maxTokens }) {
    const contents = [
      ...history.map((h) => ({ role: h.role === 'USER' ? 'user' : 'model', parts: [{ text: h.content }] })),
      { role: 'user', parts: [{ text: prompt }] },
    ];
    return pool.run((key) => transport.generate(key, {
      model: configService.get('LLM_MODEL'),
      system,
      contents,
      temperature: configService.get('LLM_TEMPERATURE'),
      maxTokens: maxTokens ?? configService.get('MAX_ANSWER_TOKENS'),
      json,
    }));
  }

  /** Vector đã chuẩn hóa độ dài 1 -> cosine = tích vô hướng (rẻ khi tính trong Node). */
  async function embed(texts, taskType = 'RETRIEVAL_DOCUMENT') {
    const out = [];
    for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
      const batch = texts.slice(i, i + EMBED_BATCH_SIZE);
      const vectors = await pool.run((key) => transport.embed(key, {
        model: configService.get('EMBEDDING_MODEL'), texts: batch, dim: configService.get('EMBEDDING_DIM'), taskType,
      }));
      out.push(...vectors.map(normalizeVector));
    }
    return out;
  }

  return { available, generate, embed, keyStatus: pool.status, modelName: () => configService.get('EMBEDDING_MODEL') };
}

function normalizeVector(v) {
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm) || 1;
  return v.map((x) => x / norm);
}

function dot(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let s = 0;
  for (let i = 0; i < a.length; i += 1) s += a[i] * b[i];
  return s;
}

module.exports = { createLlmClient, createGeminiTransport, normalizeVector, dot };
