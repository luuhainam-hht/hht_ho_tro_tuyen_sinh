'use strict';
/**
 * Môi trường test với PostgreSQL THẬT (FOR UPDATE, advisory lock, CHECK chỉ kiểm chứng được trên DB thật).
 * Mỗi file test dựng lại schema sạch + seed dữ liệu tuyển sinh thật.
 */
// Test XÓA SẠCH schema public trước mỗi file -> chỉ chạy trên CSDL có chữ "test" trong tên,
// tuyệt đối không dùng DATABASE_URL của hệ thống thật.
const TEST_URL = process.env.TEST_DATABASE_URL || 'postgres://hht:hht@localhost:5432/hht_ai_test';
if (!/test/i.test(new URL(TEST_URL).pathname)) {
  throw new Error(`TEST_DATABASE_URL phải trỏ tới CSDL có chữ "test" trong tên (đang là ${new URL(TEST_URL).pathname})`);
}
process.env.DATABASE_URL = TEST_URL;
process.env.RATE_LIMIT_ENABLED = 'false';
// Test không gọi Mindtek thật; file test nào cần thì truyền mindtekTransport giả.
process.env.HHT_TEST = '1';
process.env.GEMINI_API_KEYS = process.env.TEST_FAKE_LLM === '1' ? 'fake-key-1,fake-key-2' : '';
process.env.UPLOAD_DIR = require('node:path').join(require('node:os').tmpdir(), `hht-test-uploads-${process.pid}`);
process.env.MESSENGER_APP_SECRET = 'test-app-secret';
process.env.MESSENGER_VERIFY_TOKEN = 'test-verify';

const http = require('node:http');
const bcrypt = require('bcryptjs');
const request = require('supertest');
const { createDb, createPool } = require('../../src/config/db');
const { createContainer } = require('../../src/container');
const { createApp } = require('../../src/server');
const { runMigrations } = require('../../src/migrations/runMigrations');

const silent = { info() {}, warn() {}, error() {} };
const PASSWORD = 'MatKhauTest2026';

async function resetDatabase(db) {
  await db.withTransaction((c) => c.raw('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;'));
  await runMigrations(db, { logger: silent });
}

async function createStaff(db, username, role, { mustChange = false, faculty = null } = {}) {
  const { rows } = await db.query(
    'INSERT INTO staff (username, password_hash, full_name, role, faculty, must_change_password) VALUES (?, ?, ?, ?, ?, ?) RETURNING id',
    [username, await bcrypt.hash(PASSWORD, 4), `Cán bộ ${username}`, role, faculty, mustChange],
  );
  return Number(rows[0].id);
}

async function createTestContext({ llmTransport, groqTransport, mindtekTransport } = {}) {
  const db = createDb(createPool(process.env.DATABASE_URL), { logger: silent });
  await resetDatabase(db);
  const c = createContainer({ db, logger: silent, llmTransport, groqTransport, mindtekTransport });
  await c.configService.loadAll();
  await c.refreshMajors();
  const app = createApp(c);
  const server = http.createServer(app);
  c.wsHub.attach(server);
  await new Promise((r) => server.listen(0, r));

  async function login(username) {
    const res = await request(app).post('/api/auth/login').send({ username, password: PASSWORD }).expect(200);
    return { Authorization: `Bearer ${res.body.token}` };
  }
  async function close() {
    await c.jobRunner.stop();
    await c.wsHub.close();
    await new Promise((r) => server.close(r));
    await db.end();
  }
  return { c, db, app, server, port: server.address().port, login, close };
}

module.exports = { createTestContext, createStaff, PASSWORD, silent };
