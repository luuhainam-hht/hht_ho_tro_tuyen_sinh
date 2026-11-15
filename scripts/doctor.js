#!/usr/bin/env node
'use strict';
/**
 * Kiểm tra & sửa lỗi môi trường chạy:
 *   node scripts/doctor.js           kiểm tra, in hướng dẫn sửa
 *   node scripts/doctor.js --fix     tự sửa được gì thì sửa (tạo .env, tạo CSDL, thư mục upload)
 *   node scripts/doctor.js --test-db tạo CSDL <tên>_test và in chuỗi kết nối ở dòng cuối (cho npm test)
 * Mã thoát: 0 ổn | 1 lỗi chung | 2 thiếu thư viện | 3 cổng đang bận | 4 lỗi CSDL | 5 thiếu/hỏng .env
 */
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');

const ROOT = path.join(__dirname, '..');
const FIX = process.argv.includes('--fix');
const TEST_DB = process.argv.includes('--test-db');
const ok = (m) => console.log(`  [OK]  ${m}`);
const warn = (m) => console.log(`  [!!]  ${m}`);
const bad = (m) => console.log(`  [LỖI] ${m}`);

function checkNode() {
  const [maj, min] = process.versions.node.split('.').map(Number);
  if (maj < 20 || (maj === 20 && min < 10)) {
    bad(`Node.js ${process.versions.node} quá cũ. Cần Node 20.10 trở lên: https://nodejs.org (bản LTS).`);
    return false;
  }
  ok(`Node.js ${process.versions.node}`);
  return true;
}

function checkDeps() {
  const required = ['express', 'pg', 'ws', 'helmet', 'cors', 'express-rate-limit', 'bcryptjs', 'dotenv', '@google/genai', 'multer', 'mammoth', 'pdf-parse', 'exceljs'];
  const missing = required.filter((m) => { try { require.resolve(m, { paths: [ROOT] }); return false; } catch { return true; } });
  if (missing.length) { bad(`Thiếu thư viện: ${missing.join(', ')} -> chạy "npm ci"`); return false; }
  ok('Đủ thư viện (node_modules)');
  return true;
}

function loadEnv() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) {
    bad('Chưa có tệp .env -> chạy "node scripts/setup-env.js"');
    return null;
  }
  require('dotenv').config({ path: file, quiet: true });
  const problems = [];
  if (!process.env.DATABASE_URL || /doi-mat-khau/.test(process.env.DATABASE_URL)) problems.push('DATABASE_URL chưa điền');
  else { try { new URL(process.env.DATABASE_URL); } catch { problems.push('DATABASE_URL sai định dạng (postgres://user:pass@host:5432/db)'); } }
  if (!process.env.VISITOR_HASH_SECRET || /thay-bang/.test(process.env.VISITOR_HASH_SECRET)) problems.push('VISITOR_HASH_SECRET chưa đặt');
  const pw = process.env.ADMIN_INITIAL_PASSWORD || '';
  if (pw && !(pw.length >= 10 && /[A-Za-zÀ-ỹ]/.test(pw) && /\d/.test(pw))) problems.push('ADMIN_INITIAL_PASSWORD phải ≥10 ký tự, có chữ và số');
  if (problems.length) { problems.forEach(bad); console.log('        -> chạy "node scripts/setup-env.js" để điền lại'); return null; }
  ok('Tệp .env hợp lệ');
  return process.env;
}

function explainDbError(err, url) {
  const host = `${url.hostname}:${url.port || 5432}`;
  switch (err.code) {
    case 'ECONNREFUSED': return `Không kết nối được PostgreSQL tại ${host}. PostgreSQL chưa chạy: mở dịch vụ PostgreSQL (services.msc) hoặc chạy CSDL bằng Docker (mục "Docker" trong menu).`;
    case 'ENOTFOUND': case 'EAI_AGAIN': return `Không tìm thấy máy chủ "${url.hostname}". Kiểm tra lại DATABASE_URL hoặc kết nối mạng.`;
    case '28P01': return `Sai tên đăng nhập hoặc mật khẩu PostgreSQL (người dùng "${decodeURIComponent(url.username)}"). Sửa DATABASE_URL trong .env.`;
    case '3D000': return `CSDL "${url.pathname.slice(1)}" chưa tồn tại.`;
    case '28000': return 'Máy chủ từ chối kết nối (pg_hba.conf). Nếu dùng Neon, đặt DATABASE_SSL=true.';
    default:
      if (/SSL|ssl/.test(err.message)) return `Lỗi SSL: ${err.message}. Neon cần DATABASE_SSL=true; PostgreSQL trên máy cần DATABASE_SSL=false.`;
      return `${err.code || ''} ${err.message}`;
  }
}

async function tryConnect(connectionString) {
  const { Client } = require('pg');
  const { cleanConnectionString } = require('../src/config/db');
  const ssl = process.env.DATABASE_SSL === 'true' || /neon\.tech|sslmode=require/.test(connectionString) ? { rejectUnauthorized: true } : undefined;
  const c = new Client({ connectionString: cleanConnectionString(connectionString), ssl, connectionTimeoutMillis: 15000 });
  await c.connect();
  return c;
}

/** Tạo CSDL nếu chưa có: nối vào CSDL "postgres" bằng cùng tài khoản rồi CREATE DATABASE. */
async function createDatabase(url) {
  const admin = new URL(url.href);
  admin.pathname = '/postgres';
  const c = await tryConnect(admin.href);
  const name = url.pathname.slice(1);
  if (!/^[A-Za-z0-9_]+$/.test(name)) throw new Error(`Tên CSDL "${name}" chỉ được gồm chữ, số, gạch dưới`);
  const { rows } = await c.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
  if (!rows.length) await c.query(`CREATE DATABASE "${name}"`);
  await c.end();
  return !rows.length;
}

async function checkDb(connectionString, { create = FIX } = {}) {
  const url = new URL(connectionString);
  try {
    const c = await tryConnect(connectionString);
    const { rows } = await c.query('SHOW server_version');
    await c.end();
    ok(`Kết nối PostgreSQL ${rows[0].server_version} (${url.hostname}/${url.pathname.slice(1)})`);
    if (Number.parseInt(rows[0].server_version, 10) < 14) warn('Nên dùng PostgreSQL 14 trở lên');
    return true;
  } catch (err) {
    if (err.code === '3D000' && create) {
      try {
        await createDatabase(url);
        ok(`Đã tạo CSDL "${url.pathname.slice(1)}"`);
        return true;
      } catch (e2) {
        bad(`Không tạo được CSDL: ${explainDbError(e2, url)} (tài khoản cần quyền CREATEDB)`);
        return false;
      }
    }
    bad(explainDbError(err, url));
    return false;
  }
}

function checkPort(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => { bad(`Cổng ${port} đang bị chương trình khác dùng (có thể hệ thống đang chạy sẵn).`); resolve(false); });
    srv.once('listening', () => srv.close(() => { ok(`Cổng ${port} trống`); resolve(true); }));
    srv.listen(port, '0.0.0.0');
  });
}

function checkUploadDir() {
  const dir = path.resolve(ROOT, process.env.UPLOAD_DIR || 'data/uploads');
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(dir, fs.constants.W_OK);
    ok(`Thư mục tải lên: ${path.relative(ROOT, dir) || dir}`);
    return true;
  } catch (err) { bad(`Không ghi được thư mục tải lên ${dir}: ${err.message}`); return false; }
}

async function main() {
  console.log('\n== Kiểm tra môi trường HHT Tuyển sinh ==');
  if (!checkNode()) process.exit(1);
  if (!checkDeps()) process.exit(2);
  const env = loadEnv();
  if (!env) process.exit(5);

  if (TEST_DB) {
    const url = new URL(env.TEST_DATABASE_URL || env.DATABASE_URL);
    if (!/test/i.test(url.pathname)) url.pathname = `${url.pathname.replace(/\/$/, '')}_test`;
    if (!(await checkDb(url.href, { create: true }))) process.exit(4);
    console.log(url.href); // dòng cuối: chuỗi kết nối CSDL test
    return;
  }

  let code = 0;
  if (!(await checkDb(env.DATABASE_URL))) code = 4;
  if (!checkUploadDir()) code = code || 1;
  if (!(await checkPort(Number(env.PORT) || 3000))) code = code || 3;
  if (!env.GEMINI_API_KEYS) warn('Chưa có GEMINI_API_KEYS: hỏi đáp dùng FAQ + trích văn bản (vẫn hoạt động).');
  console.log(code ? '\nCòn lỗi cần xử lý (xem các dòng [LỖI]).' : '\nMọi thứ sẵn sàng.');
  process.exit(code);
}

main().catch((err) => { console.error('Lỗi kiểm tra:', err.message); process.exit(1); });
