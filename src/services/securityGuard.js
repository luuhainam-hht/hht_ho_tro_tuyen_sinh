'use strict';
/**
 * Lớp bảo vệ bí mật cho trợ lý (chạy bằng mã, không phụ thuộc AI "tự giác"):
 *  1. detectSecretProbe: câu hỏi dò bí mật / prompt injection (xin lời nhắc hệ thống, khóa API, mật khẩu,
 *     cơ sở dữ liệu, mã nguồn, trang quản trị của hệ thống này hoặc của hht.edu.vn) -> từ chối, KHÔNG gọi AI.
 *  2. sanitizeAnswer: mọi câu trả lời (AI, Internet, trích văn bản) đi qua bộ lọc trước khi tới thí sinh:
 *     - xóa giá trị bí mật thật của máy chủ (khóa API, chuỗi kết nối CSDL, mật khẩu khởi tạo, khóa mã hóa…)
 *     - xóa mẫu bí mật phổ biến (khóa Google "AIza…", "sk-…", JWT, token 64 hex, URL có mật khẩu, "password=…")
 *     - che số CCCD/CMND (12 số) và chặn câu trả lời làm lộ lời nhắc hệ thống.
 * Lớp này bổ sung cho quy tắc bảo mật trong lời nhắc (promptBuilder) – AI có bị lừa thì mã vẫn chặn.
 */
const { normalizeVi } = require('../utils/textNormalize');

const REFUSAL = 'Xin lỗi, mình không thể cung cấp thông tin nội bộ hay bảo mật của hệ thống và của website Nhà trường '
  + '(cấu hình, tài khoản, mật khẩu, khóa truy cập, mã nguồn, dữ liệu cá nhân…). Mình chỉ hỗ trợ thông tin công khai về tuyển sinh '
  + 'và các câu hỏi thông thường. Bạn cần tìm hiểu gì về ngành học, học phí, hồ sơ hay lịch xét tuyển?';

// ----- 1. Câu hỏi dò bí mật (so khớp trên chuỗi không dấu, chữ thường) -----
/** Lệnh "phá luật" – tự nó đã là dấu hiệu tấn công, không cần đi kèm danh từ bí mật. */
const INJECTION = [
  /\b(bo qua|quen|phot lo|vo hieu|ghi de|xoa bo|khong can tuan theo) (het |tat ca |moi |toan bo |nhung |cac )*(huong dan|chi thi|quy tac|luat|rang buoc|loi nhac|cau lenh) (truoc|tren|cu|he thong|ban dau|da cho)/,
  /\bignore (all |any |the )?(previous|prior|above|earlier|system) (instructions?|prompts?|rules?|messages?)/,
  /\b(disregard|forget|override) (all |your |the )?(previous |prior |system )?(instructions?|rules?|prompts?)/,
  /\b(system prompt|developer mode|jailbreak|dan mode|do anything now|sudo mode|god mode|prompt injection)\b/,
  /\b(loi nhac|prompt|chi dan|huong dan|quy tac) (he thong|goc|an|noi bo|ban dau|duoc cai|duoc lap trinh)\b/,
  /\b(che do|mode) (nha phat trien|developer|admin|quan tri|debug|go loi)\b/,
  /\b(dong vai|gia vo la|pretend to be|act as|you are now) .{0,30}(admin|quan tri|lap trinh vien|developer|he thong|hacker|khong co gioi han|unrestricted)/,
  /\b(repeat|print|show|reveal|output) (your |the )?(instructions|system|prompt|rules|initial)/,
  // Hỏi cách tấn công website/hệ thống của trường
  /\b(hack|tan cong|xam nhap|be khoa|crack|ddos|chiem quyen|vuot qua dang nhap|bypass)\b.{0,40}\b(web|website|trang|he thong|may chu|server|tai khoan|hht|chatbot|tro ly|du lieu)\b/,
];
/**
 * Danh từ bí mật: chỉ chặn khi đi cùng động từ "xin/cho xem/tiết lộ/cách lấy…". Viết cụ thể để không chặn câu
 * hợp lệ: "quên mật khẩu đăng ký online", "số tài khoản ngân hàng của trường để đóng học phí",
 * "danh sách thí sinh trúng tuyển" vẫn được trả lời.
 */
const SECRET_NOUN = new RegExp([
  'api ?key', 'khoa api', 'khoa bi mat', 'secret key', 'access token', 'bearer token', 'token (dang nhap|truy cap|admin|api)',
  '(mat khau|password|pass) (cua |dang nhap |vao )?(admin|quan tri|he thong|server|may chu|database|co so du lieu|csdl|website|trang web|web|hosting|email|gmail|can bo|giao vien|phong tuyen sinh|chatbot|tro ly|bot)',
  'tai khoan (quan tri|admin|can bo|giao vien|he thong|hosting|email can bo|dang nhap trang quan tri)',
  'database', 'co so du lieu', 'csdl', 'chuoi ket noi', 'connection string',
  'ma nguon', 'source ?code', 'file \\.?env', 'bien moi truong', 'environment variables?',
  'cau hinh (he thong|may chu|server|chatbot|tro ly|ai|bot)', '(ip|dia chi ip) (cua )?(may chu|server|website)', 'thong tin (may chu|server|hosting)',
  'trang (quan tri|admin)', 'duong dan (quan tri|admin|an|noi bo)', 'admin panel', 'cpanel', 'wp-admin', 'phpmyadmin', 'admin html',
  'lo hong', 'exploit', 'sql injection', 'xss', 'backdoor', 'ddos', 'tan cong (website|trang web|he thong|may chu)',
  '(du lieu|thong tin) ca nhan (cua )?(thi sinh|hoc sinh|sinh vien|nguoi dung|nguoi|phu huynh) khac', 'du lieu (thi sinh|nguoi dung|ho so) (trong he thong|tren he thong|toan bo)',
  'so dien thoai (rieng|ca nhan) (cua )?(giao vien|can bo|thay|co|hieu truong)', '(cccd|can cuoc|cmnd) (cua )?(thi sinh|hoc sinh|nguoi khac|giao vien|can bo)',
  'lich su (chat|tro chuyen|hoi dap) (cua )?(nguoi khac|nguoi dung khac|thi sinh khac)', 'ghi chu noi bo', 'internal notes?', 'tai lieu (noi bo|mat)',
].map((x) => `\\b(${x})\\b`).join('|'));
const ASK_VERB = /\b(cho (toi|minh|em|tao|xin)? ?(xem|biet|lay)|xin|tiet lo|lo|cung cap|liet ke|gui|in ra|hien thi|doc|chia se|dump|export|xuat|lay|truy cap|vao|dang nhap|hack|be khoa|crack|tim|tra cuu|la gi|bao nhieu|o dau|nhu the nao|cach|lam sao|the nao|nao|dau|link|url|nam o)\b|\b(show|give|reveal|print|list|send|leak|what is|what are|tell me|how to)\b/;

function detectSecretProbe(question) {
  const n = normalizeVi(question);
  if (!n) return false;
  if (INJECTION.some((re) => re.test(n))) return true;
  return SECRET_NOUN.test(n) && ASK_VERB.test(n);
}

// ----- 2. Lọc câu trả lời -----
const SECRET_PATTERNS = [
  /AIza[0-9A-Za-z_-]{30,}/g,                                   // khóa Google/Gemini
  /\bsk-[A-Za-z0-9_-]{20,}/g,                                  // khóa kiểu OpenAI/Anthropic
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, // JWT
  /\b[a-f0-9]{64}\b/gi,                                        // token phiên 64 hex
  /\b(postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s"'<>]+/gi, // chuỗi kết nối CSDL
  /\bhttps?:\/\/[^\s/:@"'<>]+:[^\s/@"'<>]+@[^\s"'<>]+/gi,        // URL có user:mật khẩu
  /\b(password|passwd|pwd|mat khau|mật khẩu|secret|api[_ -]?key|token)\s*[:=]\s*\S{6,}/gi,
];
// Số CCCD/CMND chỉ che khi đứng sau chữ "CCCD/CMND/căn cước" (không che số tài khoản ngân hàng, mã hồ sơ…).
const CCCD = /((?:CCCD|CMND|CCCD\/CMND|căn cước|chứng minh (?:nhân dân|thư))[^\d\n]{0,20})(\d{3})\d{3,6}(\d{3})\b/gi;
/** Cụm chỉ có trong lời nhắc hệ thống: xuất hiện trong câu trả lời = AI đang đọc lại lời nhắc. */
const PROMPT_MARKERS = ['QUY TẮC BẮT BUỘC', 'QUY TẮC BẢO MẬT', '<NGU_CANH', '<CAU_HOI', 'NGU_CANH_NOI_BO', 'KHONG_TIM_THAY', 'HƯỚNG DẪN BỔ SUNG CỦA NHÀ TRƯỜNG', '"insufficient"'];
const MIN_SECRET_LEN = 6;

function createSecurityGuard({ secrets = () => [] } = {}) {
  /** Giá trị bí mật thật đang dùng (lấy mới mỗi lần: Admin có thể thêm/đổi khóa API lúc đang chạy). */
  const liveSecrets = () => [...new Set((secrets() || []).map((s) => String(s || '').trim()).filter((s) => s.length >= MIN_SECRET_LEN))];

  function sanitizeAnswer(text) {
    let out = String(text ?? '');
    if (PROMPT_MARKERS.some((m) => out.includes(m))) return { text: REFUSAL, blocked: true, redacted: true };
    let redacted = false;
    for (const s of liveSecrets()) {
      if (out.includes(s)) { out = out.split(s).join('[đã ẩn]'); redacted = true; }
    }
    for (const re of SECRET_PATTERNS) {
      out = out.replace(re, () => { redacted = true; return '[đã ẩn]'; });
    }
    out = out.replace(CCCD, (_m, label, a, b) => { redacted = true; return `${label}${a}******${b}`; });
    return { text: out, blocked: false, redacted };
  }

  return { detectSecretProbe, sanitizeAnswer, REFUSAL };
}

module.exports = { createSecurityGuard, detectSecretProbe, REFUSAL };
