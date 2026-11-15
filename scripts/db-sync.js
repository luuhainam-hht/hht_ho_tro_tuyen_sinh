#!/usr/bin/env node
'use strict';
/**
 * Đồng bộ / sao lưu CSDL giữa PostgreSQL chạy bằng Docker (máy cục bộ) và Neon (đám mây).
 *
 *   node scripts/db-sync.js status                 so sánh 2 CSDL (phiên bản, số dòng các bảng chính)
 *   node scripts/db-sync.js neon-to-docker         Neon -> Docker (Docker bị ghi đè, có sao lưu trước)
 *   node scripts/db-sync.js docker-to-neon         Docker -> Neon (Neon bị ghi đè, có sao lưu trước)
 *   node scripts/db-sync.js backup docker|neon     sao lưu ra backups/*.sql.gz
 *   node scripts/db-sync.js restore <file> docker|neon
 *   node scripts/db-sync.js migrate-docker [--refresh-seed]   tạo/cập nhật bảng + dữ liệu dự án trong Docker
 *   node scripts/db-sync.js reset-admin-docker [username]    đặt lại mật khẩu quản trị trong CSDL Docker
 *   Thêm --yes để bỏ qua câu hỏi xác nhận.
 *
 * Công cụ pg_dump/psql chạy trong container postgres:<phiên bản>-alpine (không cần cài PostgreSQL trên
 * Windows), phiên bản chọn theo máy chủ mới hơn trong hai bên. Đặt PG_TOOLS=local để dùng pg_dump/psql
 * đã cài trên máy. URL truyền qua biến môi trường của tiến trình con -> không lỗi ký tự & ? trên cmd.
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync, spawn } = require('node:child_process');
const readline = require('node:readline/promises');

const ROOT = path.join(__dirname, '..');
const ENV_FILE = path.join(ROOT, '.env');
const BACKUP_DIR = path.join(ROOT, 'backups');
const LOCAL_DB = 'hht_tuyen_sinh';
const LOCAL_USER = 'hht';
const TABLES = ['staff', 'kb_documents', 'kb_chunks', 'faq_entries', 'majors', 'admission_items', 'chat_sessions', 'chat_messages', 'handoff_requests', 'appointments'];
const args = process.argv.slice(2);
const YES = args.includes('--yes');
const LOCAL_TOOLS = process.env.PG_TOOLS === 'local';

require('dotenv').config({ path: ENV_FILE, quiet: true });

const say = (m) => console.log(m);
const fail = (m) => { console.error(`\n[LỖI] ${m}`); process.exit(1); };
const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace('T', '_').slice(0, 15);

function run(cmd, cmdArgs, { input, quiet = false, env = {} } = {}) {
  const r = spawnSync(cmd, cmdArgs, { cwd: ROOT, encoding: 'utf8', input, env: { ...process.env, ...env }, maxBuffer: 64 * 1024 * 1024 });
  if (r.error) return { code: 1, out: '', err: r.error.message };
  if (!quiet && r.status !== 0 && r.stderr) process.stderr.write(r.stderr);
  return { code: r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}

// ---------------------------------------------------------------------------
// Cấu hình 2 đầu
// ---------------------------------------------------------------------------
function upsertEnvValue(key, value) {
  let text = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf8') : '';
  const line = `${key}=${value}`;
  text = new RegExp(`^${key}=.*$`, 'm').test(text) ? text.replace(new RegExp(`^${key}=.*$`, 'm'), line) : `${text.replace(/\s*$/, '')}\n${line}\n`;
  fs.writeFileSync(ENV_FILE, text);
}

async function neonUrl() {
  let url = process.env.NEON_DATABASE_URL || (/neon\.tech/.test(process.env.DATABASE_URL || '') ? process.env.DATABASE_URL : '');
  if (!url) {
    if (!process.stdin.isTTY) fail('Chưa có NEON_DATABASE_URL trong .env');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    say('\nDán chuỗi kết nối Neon (Neon Console > Connect > Connection string, dạng postgresql://...neon.tech/...):');
    url = (await rl.question('> ')).trim();
    rl.close();
    if (!/^postgres(ql)?:\/\//.test(url)) fail('Chuỗi kết nối không hợp lệ');
    upsertEnvValue('NEON_DATABASE_URL', url);
    say('Đã lưu NEON_DATABASE_URL vào .env');
  }
  const u = new URL(url);
  // pg_dump cần kết nối trực tiếp: PgBouncer (host "-pooler") không hỗ trợ đủ lệnh.
  u.hostname = u.hostname.replace('-pooler.', '.');
  if (!u.searchParams.has('sslmode')) u.searchParams.set('sslmode', 'require');
  return u.toString();
}

function dockerUrl({ fromHost = false } = {}) {
  const pw = process.env.POSTGRES_PASSWORD;
  if (!pw || /doi-mat-khau/.test(pw)) fail('Chưa có POSTGRES_PASSWORD trong .env (chạy hht-tuyen-sinh.bat mục 9 hoặc mục 1)');
  const host = fromHost || LOCAL_TOOLS ? '127.0.0.1' : 'db';
  return `postgres://${LOCAL_USER}:${encodeURIComponent(pw)}@${host}:5432/${process.env.DOCKER_DB_NAME || LOCAL_DB}`;
}

// ---------------------------------------------------------------------------
// Docker
// ---------------------------------------------------------------------------
function ensureDocker() {
  if (LOCAL_TOOLS) return;
  if (run('docker', ['info'], { quiet: true }).code !== 0) fail('Docker chưa chạy. Mở Docker Desktop rồi thử lại.');
}

function ensureDockerDb() {
  if (LOCAL_TOOLS) return;
  say('Khởi động PostgreSQL trong Docker...');
  if (run('docker', ['compose', 'up', '-d', 'db']).code !== 0) fail('Không chạy được container db (cổng 5432 bị chiếm?)');
  for (let i = 0; i < 30; i += 1) {
    if (run('docker', ['compose', 'exec', '-T', 'db', 'pg_isready', '-U', LOCAL_USER, '-d', LOCAL_DB], { quiet: true }).code === 0) return;
    spawnSync(process.platform === 'win32' ? 'timeout' : 'sleep', process.platform === 'win32' ? ['/t', '2', '/nobreak'] : ['2'], { stdio: 'ignore', shell: process.platform === 'win32' });
  }
  fail('PostgreSQL trong Docker chưa sẵn sàng sau 60 giây');
}

let cachedNetwork = null;
function composeNetwork() {
  if (cachedNetwork) return cachedNetwork;
  const id = run('docker', ['compose', 'ps', '-q', 'db'], { quiet: true }).out.split('\n')[0];
  if (!id) fail('Không tìm thấy container db');
  cachedNetwork = run('docker', ['inspect', id, '-f', '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}'], { quiet: true }).out.split(' ')[0];
  return cachedNetwork;
}

let toolVersion = null;
/** Chạy lệnh shell trong container công cụ postgres (hoặc shell máy khi PG_TOOLS=local). */
function pgShell(script, env = {}, { quiet = false } = {}) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  if (LOCAL_TOOLS) {
    const localEnv = Object.fromEntries(Object.entries(env).map(([k, v]) => [k, k === 'FILE' ? path.join(BACKUP_DIR, v) : v]));
    return run(process.platform === 'win32' ? 'sh' : 'bash', ['-c', script.replace(/\/backups\/\$FILE/g, '$FILE')], { env: localEnv, quiet });
  }
  const e = Object.entries(env).flatMap(([k, v]) => ['-e', `${k}=${v}`]);
  return run('docker', ['run', '--rm', '-i', '--network', composeNetwork(), '-v', `${BACKUP_DIR}:/backups`, ...e,
    `postgres:${toolVersion || 17}-alpine`, 'sh', '-c', script], { quiet });
}

function serverMajor(url) {
  const r = pgShell('psql "$U" -tAc "show server_version_num"', { U: url }, { quiet: true });
  if (r.code !== 0) return { ok: false, err: r.err };
  return { ok: true, major: Math.floor(Number(r.out) / 10000) };
}

function chooseToolVersion(urls) {
  if (LOCAL_TOOLS) return;
  toolVersion = 17;
  const majors = urls.map((u) => serverMajor(u)).filter((x) => x.ok).map((x) => x.major);
  toolVersion = Math.max(16, ...majors);
}

// ---------------------------------------------------------------------------
// Thao tác
// ---------------------------------------------------------------------------
function label(target) { return target === 'neon' ? 'Neon (đám mây)' : 'Docker (máy này)'; }

async function urlOf(target) { return target === 'neon' ? neonUrl() : dockerUrl(); }

function checkConnect(url, target) {
  const r = pgShell('psql "$U" -tAc "select 1"', { U: url }, { quiet: true });
  if (r.code !== 0) fail(`Không kết nối được ${label(target)}:\n${r.err}`);
}

function backup(url, target) {
  const file = `${target}_${stamp()}.sql.gz`;
  say(`Sao lưu ${label(target)} -> backups/${file}`);
  // Không kèm owner/quyền: Neon và Docker dùng tên vai trò khác nhau.
  const r = pgShell('set -o pipefail; pg_dump --dbname="$U" --no-owner --no-acl --schema=public | gzip > "/backups/$FILE"', { U: url, FILE: file });
  if (r.code !== 0) fail(`Sao lưu ${label(target)} thất bại`);
  return file;
}

function restore(file, url, target) {
  say(`Nạp backups/${file} vào ${label(target)}...`);
  // Xóa sạch schema public rồi nạp, TẤT CẢ trong một transaction: lỗi giữa chừng thì đích giữ nguyên.
  // Lọc lệnh chỉ có ở bản pg_dump mới (transaction_timeout) để nạp được vào máy chủ PostgreSQL cũ hơn.
  const script = '{ echo "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;"; '
    + 'gunzip -c "/backups/$FILE" | sed -e "/^SET transaction_timeout/d" -e "/^CREATE SCHEMA public;/d" -e "/^COMMENT ON SCHEMA public/d"; } '
    + '| psql "$U" -v ON_ERROR_STOP=1 -q --single-transaction';
  const r = pgShell(script, { U: url, FILE: file });
  if (r.code !== 0) fail(`Nạp dữ liệu vào ${label(target)} thất bại – dữ liệu cũ vẫn còn trong bản sao lưu ở thư mục backups/`);
}

function counts(url) {
  const sql = TABLES.map((t) => `select '${t}', (select count(*) from ${t})`).join(' union all ');
  const r = pgShell('psql "$U" -tA -F "|" -c "$Q" 2>&1', { U: url, Q: sql }, { quiet: true });
  if (r.code !== 0) return null;
  return Object.fromEntries(r.out.split('\n').filter((l) => l.includes('|')).map((l) => l.split('|')));
}

async function confirm(question) {
  if (YES) return true;
  if (!process.stdin.isTTY) fail('Cần xác nhận: chạy lại với --yes');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const a = (await rl.question(`${question} Gõ "dong y" để tiếp tục: `)).trim().toLowerCase();
  rl.close();
  return ['dong y', 'đồng ý', 'yes', 'y'].includes(a);
}

function stopDockerApp() {
  if (LOCAL_TOOLS) return false;
  const running = run('docker', ['compose', 'ps', '-q', '--status', 'running', 'app'], { quiet: true }).out;
  if (!running) return false;
  say('Tạm dừng container app trong lúc ghi dữ liệu...');
  run('docker', ['compose', 'stop', 'app'], { quiet: true });
  return true;
}

async function sync(from, to) {
  ensureDocker();
  ensureDockerDb();
  const src = await urlOf(from);
  const dst = await urlOf(to);
  chooseToolVersion([src, dst]);
  checkConnect(src, from);
  checkConnect(dst, to);
  say(`\nNguồn: ${label(from)}  ->  Đích: ${label(to)}`);
  const cs = counts(src) || {};
  const cd = counts(dst) || {};
  say(`  ${'Bảng'.padEnd(18)}${'Nguồn'.padStart(10)}${'Đích'.padStart(10)}`);
  for (const t of TABLES) say(`  ${t.padEnd(18)}${String(cs[t] ?? '-').padStart(10)}${String(cd[t] ?? '-').padStart(10)}`);
  if (!(await confirm(`\nToàn bộ dữ liệu ở ${label(to)} sẽ được THAY bằng dữ liệu của ${label(from)} (có sao lưu trước).`))) fail('Đã hủy.');
  if (to === 'neon') say('Lưu ý: nên tạm dừng dịch vụ web đang dùng Neon (Render > Suspend) trong lúc đồng bộ.');
  const appWasRunning = to === 'docker' && stopDockerApp();
  const safety = backup(dst, to);
  const data = backup(src, from);
  restore(data, dst, to);
  if (appWasRunning) run('docker', ['compose', 'start', 'app'], { quiet: true });
  const after = counts(dst) || {};
  const mismatch = TABLES.filter((t) => String(after[t]) !== String(cs[t]));
  say(mismatch.length ? `\n[!!] Lệch số dòng ở: ${mismatch.join(', ')}` : '\n[OK] Đồng bộ xong, số dòng các bảng khớp với nguồn.');
  say(`Bản sao lưu dữ liệu cũ của đích: backups/${safety} (khôi phục: node scripts/db-sync.js restore ${safety} ${to})`);
}

async function status() {
  ensureDocker();
  ensureDockerDb();
  const d = dockerUrl();
  const n = await neonUrl();
  chooseToolVersion([d, n]);
  for (const [t, u] of [['docker', d], ['neon', n]]) {
    const v = serverMajor(u);
    say(`\n${label(t)}: ${v.ok ? `PostgreSQL ${v.major}` : `KHÔNG KẾT NỐI ĐƯỢC – ${v.err}`}`);
    if (!v.ok) continue;
    const c = counts(u);
    if (!c) { say('  (chưa có bảng của hệ thống)'); continue; }
    for (const tb of TABLES) say(`  ${tb.padEnd(18)}${String(c[tb]).padStart(8)}`);
  }
}

async function migrateDocker() {
  ensureDocker();
  ensureDockerDb();
  const refresh = args.includes('--refresh-seed');
  const url = dockerUrl({ fromHost: true });
  if (refresh) {
    chooseToolVersion([dockerUrl()]);
    if (!(await confirm('FAQ, ngành, mục cẩm nang trong Docker sẽ được ghi đè bằng dữ liệu mới nhất của dự án (có sao lưu trước).'))) fail('Đã hủy.');
    backup(dockerUrl(), 'docker');
  }
  say(refresh ? 'Cập nhật bảng và dữ liệu tuyển sinh...' : 'Tạo/cập nhật bảng và nạp dữ liệu còn thiếu...');
  const child = spawn(process.execPath, ['src/migrations/runMigrations.js', ...(refresh ? ['--refresh-seed'] : [])], {
    cwd: ROOT, stdio: 'inherit', env: { ...process.env, DATABASE_URL: url, DATABASE_SSL: 'false' },
  });
  const code = await new Promise((r) => child.on('close', r));
  if (code !== 0) fail('Cập nhật CSDL Docker thất bại');
  say('[OK] CSDL Docker đã cập nhật.');
}

/** Chạy một script Node của dự án với DATABASE_URL trỏ vào PostgreSQL trong Docker. */
async function runOnDocker(script, scriptArgs) {
  ensureDocker();
  ensureDockerDb();
  const child = spawn(process.execPath, [script, ...scriptArgs], {
    cwd: ROOT, stdio: 'inherit', env: { ...process.env, DATABASE_URL: dockerUrl({ fromHost: true }), DATABASE_SSL: 'false' },
  });
  const code = await new Promise((r) => child.on('close', r));
  if (code !== 0) process.exit(code);
}

async function main() {
  const [cmd, a1, a2] = args.filter((x) => !x.startsWith('--'));
  switch (cmd) {
    case 'reset-admin-docker': return runOnDocker('scripts/reset-admin-password.js', [a1 || 'admin']);
    case 'status': return status();
    case 'neon-to-docker': return sync('neon', 'docker');
    case 'docker-to-neon': return sync('docker', 'neon');
    case 'migrate-docker': return migrateDocker();
    case 'backup': {
      if (!['docker', 'neon'].includes(a1)) fail('Cách dùng: backup docker|neon');
      ensureDocker(); ensureDockerDb();
      const u = await urlOf(a1);
      chooseToolVersion([u]);
      checkConnect(u, a1);
      const f = backup(u, a1);
      return say(`[OK] backups/${f}`);
    }
    case 'restore': {
      if (!a1 || !['docker', 'neon'].includes(a2)) fail('Cách dùng: restore <tên-file-trong-backups> docker|neon');
      const file = path.basename(a1);
      if (!fs.existsSync(path.join(BACKUP_DIR, file))) fail(`Không có backups/${file}`);
      ensureDocker(); ensureDockerDb();
      const u = await urlOf(a2);
      chooseToolVersion([u]);
      checkConnect(u, a2);
      if (!(await confirm(`Dữ liệu hiện tại của ${label(a2)} sẽ được thay bằng backups/${file}.`))) fail('Đã hủy.');
      backup(u, a2);
      restore(file, u, a2);
      return say('[OK] Đã khôi phục.');
    }
    default:
      say('Lệnh: status | neon-to-docker | docker-to-neon | backup docker|neon | restore <file> docker|neon | migrate-docker [--refresh-seed] | reset-admin-docker [user]');
      return process.exit(cmd ? 1 : 0);
  }
}

main().catch((err) => fail(err.message));
