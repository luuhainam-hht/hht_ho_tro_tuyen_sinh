#!/usr/bin/env node
'use strict';
/**
 * Tạo / bổ sung tệp .env (hỏi từng mục, giữ nguyên giá trị đã có):
 *   node scripts/setup-env.js            hỏi tương tác
 *   node scripts/setup-env.js --defaults không hỏi, chỉ điền giá trị tự sinh (bí mật ngẫu nhiên)
 * Không ghi đè giá trị người dùng đã nhập. Mật khẩu/khóa chỉ nằm trong .env (đã có trong .gitignore).
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const readline = require('node:readline/promises');

const ROOT = path.join(__dirname, '..');
const ENV_FILE = path.join(ROOT, '.env');
const EXAMPLE_FILE = path.join(ROOT, '.env.example');
const PLACEHOLDER = /doi-mat-khau|thay-bang|^$/;
const nonInteractive = process.argv.includes('--defaults') || !process.stdin.isTTY;

function readEnv(file) {
  const map = new Map();
  if (!fs.existsSync(file)) return map;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (m) map.set(m[1], m[2]);
  }
  return map;
}

/** Ghi lại .env theo bố cục của .env.example (giữ chú thích), thêm khóa lạ ở cuối. */
function writeEnv(values) {
  const lines = fs.readFileSync(EXAMPLE_FILE, 'utf8').split(/\r?\n/);
  const used = new Set();
  const out = lines.map((line) => {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (!m) return line;
    used.add(m[1]);
    return `${m[1]}=${values.get(m[1]) ?? m[2]}`;
  });
  for (const [k, v] of values) if (!used.has(k)) out.push(`${k}=${v}`);
  fs.writeFileSync(ENV_FILE, out.join('\n'));
}

const strongEnough = (pw) => pw.length >= 10 && /[A-Za-zÀ-ỹ]/.test(pw) && /\d/.test(pw);
const randomPassword = () => `Hht${crypto.randomBytes(9).toString('base64url')}9`;

async function main() {
  const example = readEnv(EXAMPLE_FILE);
  const env = readEnv(ENV_FILE);
  const created = !fs.existsSync(ENV_FILE);
  for (const [k, v] of example) if (!env.has(k)) env.set(k, v);

  if (PLACEHOLDER.test(env.get('VISITOR_HASH_SECRET') || '')) env.set('VISITOR_HASH_SECRET', crypto.randomBytes(32).toString('hex'));
  if (PLACEHOLDER.test(env.get('POSTGRES_PASSWORD') || '')) env.set('POSTGRES_PASSWORD', crypto.randomBytes(12).toString('hex'));

  const rl = nonInteractive ? null : readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = async (q, def = '') => {
    if (!rl) return def;
    const a = (await rl.question(`${q}${def ? ` [${def}]` : ''}: `)).trim();
    return a || def;
  };

  console.log(created ? '\n== Tạo tệp cấu hình .env ==' : '\n== Kiểm tra tệp cấu hình .env ==');

  // --defaults: chỉ điền bí mật tự sinh, không đoán thay người dùng phần CSDL và mật khẩu quản trị.
  if (!nonInteractive && (PLACEHOLDER.test(env.get('DATABASE_URL') || '') || /doi-mat-khau/.test(env.get('DATABASE_URL') || ''))) {
    console.log('\nCơ sở dữ liệu PostgreSQL:');
    console.log('  1) Dùng PostgreSQL chạy bằng Docker (tự tạo, khuyên dùng nếu máy có Docker Desktop)');
    console.log('  2) Dùng PostgreSQL đã cài trên máy');
    console.log('  3) Dán chuỗi kết nối có sẵn (Neon, máy chủ khác)');
    const choice = await ask('Chọn', '1');
    if (choice === '2') {
      const user = await ask('  Tên đăng nhập PostgreSQL', 'postgres');
      const pass = await ask('  Mật khẩu PostgreSQL', 'postgres');
      const host = await ask('  Máy chủ', 'localhost');
      const port = await ask('  Cổng', '5432');
      const db = await ask('  Tên CSDL (tự tạo nếu chưa có)', 'hht_tuyen_sinh');
      env.set('DATABASE_URL', `postgres://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}:${port}/${db}`);
    } else if (choice === '3') {
      env.set('DATABASE_URL', await ask('  Chuỗi kết nối postgres://...'));
      if (/neon\.tech|sslmode=require/.test(env.get('DATABASE_URL'))) env.set('DATABASE_SSL', 'true');
    } else {
      env.set('DATABASE_URL', `postgres://hht:${env.get('POSTGRES_PASSWORD')}@localhost:${env.get('DOCKER_DB_PORT') || 5432}/hht_tuyen_sinh`);
      env.set('DATABASE_SSL', 'false');
      env.set('USE_DOCKER_DB', 'true');
    }
  }

  if (!nonInteractive && !env.get('ADMIN_INITIAL_PASSWORD')) {
    let pw = '';
    while (!strongEnough(pw)) {
      pw = await ask('\nMật khẩu tài khoản quản trị "admin" (≥10 ký tự, có chữ và số; Enter để tự sinh)', '');
      if (!pw) { pw = randomPassword(); console.log(`  Đã sinh mật khẩu: ${pw}  (đăng nhập lần đầu sẽ phải đổi)`); }
      else if (!strongEnough(pw)) console.log('  Mật khẩu chưa đủ mạnh, nhập lại.');
    }
    env.set('ADMIN_INITIAL_PASSWORD', pw);
  }

  if (!env.get('GEMINI_API_KEYS') && rl) {
    const keys = await ask('\nKhóa Gemini API (nhiều khóa cách nhau dấu phẩy; Enter để bỏ qua – vẫn chạy bằng FAQ + trích văn bản)', '');
    env.set('GEMINI_API_KEYS', keys);
  }

  rl?.close();
  writeEnv(env);
  console.log(`\nĐã lưu ${path.relative(process.cwd(), ENV_FILE) || '.env'}.`);
}

main().catch((err) => { console.error('Lỗi tạo .env:', err.message); process.exit(1); });
