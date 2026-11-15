'use strict';
/**
 * Nguồn DUY NHẤT của danh sách tham số nghiệp vụ. runMigrations upsert metadata mỗi lần khởi động
 * (ON CONFLICT chỉ cập nhật kiểu/biên/mô tả, không ghi đè giá trị Admin đã sửa).
 * Vì sao: bản gốc phải khai báo ở cả schema.sql lẫn runMigrations -> từng quên một bên, get() ném lỗi.
 *
 * Tham số ghi "MẪU" là giá trị tạm do website trường chưa công bố – cần Trung tâm Tuyển sinh xác nhận.
 */
/**
 * group: nhóm hiển thị trên trang quản trị (AI, RAG, SECURITY có tab riêng); label: tên ngắn cho cán bộ.
 * group/label chỉ dùng để hiển thị nên không lưu vào CSDL.
 */
let currentGroup = 'GENERAL';
const C = (key, value, type, label, description, extra = {}) => ({
  key, value: String(value), type, label, description, min: null, max: null, isPublic: false, group: currentGroup, ...extra,
});
const group = (name) => { currentGroup = name; return []; };

const CONFIG_DEFAULTS = [
  // --- AI tạo sinh ---
  ...group('AI'),
  C('AI_ENABLED', true, 'BOOL', 'Bật AI tạo sinh', 'Tắt thì trợ lý chỉ trả lời bằng câu hỏi thường gặp và trích nguyên văn tài liệu'),
  C('LLM_MODEL', 'gemini-2.5-flash', 'STRING', 'Mô hình trả lời', 'Tên mô hình Gemini dùng để soạn câu trả lời'),
  C('LLM_FALLBACK_MODEL', 'gemini-2.5-flash-lite', 'STRING', 'Mô hình dự phòng', 'Dùng khi mô hình chính lỗi hoặc quá tải. Để trống nếu không dùng'),
  C('LLM_TEMPERATURE', 0.2, 'NUMBER', 'Độ sáng tạo', 'Thấp = câu trả lời ổn định, bám tài liệu; cao = diễn đạt phong phú hơn', { min: 0, max: 1 }),
  C('LLM_TIMEOUT_SECONDS', 20, 'INT', 'Thời gian chờ tối đa (giây)', 'Quá thời gian này trợ lý chuyển sang trích nguyên văn tài liệu', { min: 5, max: 60 }),
  C('MAX_ANSWER_TOKENS', 800, 'INT', 'Độ dài tối đa (token)', 'Trần token cho mỗi câu trả lời', { min: 100, max: 4000 }),
  C('MAX_HISTORY_TURNS', 6, 'INT', 'Số lượt hội thoại nhớ', 'Số lượt hỏi – đáp gần nhất gửi kèm để AI hiểu ngữ cảnh', { min: 0, max: 20 }),
  C('DAILY_TOKEN_BUDGET', 400000, 'INT', 'Ngân sách token mỗi ngày', 'Vượt mức này trợ lý chỉ trả lời bằng FAQ và trích văn bản đến hết ngày. 0 = không dùng AI', { min: 0, max: 100000000 }),
  C('AI_ASSISTANT_NAME', 'Tư vấn tuyển sinh', 'STRING', 'Tên trợ lý', 'Hiện ở đầu khung chat và trong lời nhắc gửi AI', { isPublic: true }),
  C('AI_TONE', 'THAN_THIEN', 'STRING', 'Giọng văn', 'Cách xưng hô và mức độ trang trọng của câu trả lời'),
  C('AI_ANSWER_MAX_WORDS', 150, 'INT', 'Số từ tối đa mỗi câu trả lời', 'Hướng dẫn độ dài cho AI', { min: 50, max: 400 }),
  C('AI_EXTRA_INSTRUCTIONS', '', 'STRING', 'Hướng dẫn bổ sung', 'Yêu cầu riêng của Nhà trường gửi kèm cho AI (không thay được các quy tắc chống bịa)'),
  C('AI_RECOMMEND_EXPLAIN', true, 'BOOL', 'AI giải thích kết quả gợi ý ngành', 'Tắt thì trang Gợi ý ngành chỉ hiện lý do tính theo điểm'),
  C('EMBEDDING_MODEL', 'gemini-embedding-001', 'STRING', 'Mô hình vector', 'Đổi mô hình thì hệ thống tự tạo lại vector cho toàn bộ kho'),
  C('EMBEDDING_DIM', 768, 'INT', 'Số chiều vector', 'Đổi thì hệ thống tự tạo lại vector cho toàn bộ kho', { min: 128, max: 3072 }),
  // --- Tìm kiếm tài liệu & FAQ ---
  ...group('RAG'),
  C('RAG_TOP_K', 5, 'INT', 'Số đoạn tài liệu đưa cho AI', 'Số đoạn văn bản liên quan nhất gửi kèm câu hỏi', { min: 1, max: 10 }),
  C('RAG_MIN_SCORE', 0.6, 'NUMBER', 'Ngưỡng giống nghĩa', 'Độ giống tối thiểu (khi đã có vector) để coi là có căn cứ trả lời', { min: 0, max: 1 }),
  C('RAG_MIN_LEXICAL_SCORE', 0.5, 'NUMBER', 'Ngưỡng trùng từ khóa', 'Tỉ lệ từ khóa trùng tối thiểu để coi là có căn cứ trả lời', { min: 0, max: 1 }),
  C('FAQ_MATCH_SCORE', 0.85, 'NUMBER', 'Ngưỡng khớp FAQ (vector)', 'Đạt ngưỡng này thì trả nguyên văn câu trả lời FAQ đã duyệt', { min: 0, max: 1 }),
  C('FAQ_LEXICAL_MATCH_SCORE', 0.62, 'NUMBER', 'Ngưỡng khớp FAQ (từ khóa)', 'Dùng khi chưa có vector', { min: 0, max: 1 }),
  C('AI_CACHE_ENABLED', true, 'BOOL', 'Dùng bộ nhớ đệm', 'Câu hỏi lặp lại lấy câu trả lời đã có, không tốn token'),
  C('CACHE_TTL_HOURS', 72, 'INT', 'Giữ bộ nhớ đệm (giờ)', 'Câu trả lời đệm tự hết hạn sau số giờ này', { min: 1, max: 720 }),
  // --- Đăng nhập & mật khẩu ---
  ...group('SECURITY'),
  C('PASSWORD_MIN_LENGTH', 10, 'INT', 'Độ dài mật khẩu tối thiểu', 'Áp dụng khi đặt hoặc đổi mật khẩu (luôn cần cả chữ và số)', { min: 8, max: 64 }),
  C('SESSION_TTL_HOURS', 8, 'INT', 'Thời hạn phiên đăng nhập (giờ)', 'Hết thời hạn cán bộ phải đăng nhập lại', { min: 1, max: 72 }),
  C('LOGIN_MAX_FAILED_ATTEMPTS', 5, 'INT', 'Số lần nhập sai trước khi khóa', 'Nhập sai mật khẩu liên tiếp bấy nhiêu lần thì tạm khóa tài khoản', { min: 3, max: 20 }),
  C('LOGIN_LOCK_MINUTES', 15, 'INT', 'Thời gian tạm khóa (phút)', 'Tài khoản tự mở lại sau số phút này', { min: 1, max: 1440 }),
  // --- Chung ---
  ...group('GENERAL'),
  C('CURRENT_ADMISSION_YEAR', 2026, 'INT', 'Năm tuyển sinh', 'Năm tuyển sinh hiện hành (2026 = năm học 2026–2027)', { min: 2020, max: 2100 }),
  // --- Liên hệ & giao diện (công khai) ---
  ...group('CONTACT'),
  C('SCHOOL_NAME', 'Trường Cao đẳng Công nghệ cao Hà Nội', 'STRING', 'Tên trường', 'Tên trường hiển thị', { isPublic: true }),
  C('HOTLINE', '0981 670 588', 'STRING', 'Hotline', 'Hotline tuyển sinh chung (chân trang website trường)', { isPublic: true }),
  C('ADMISSION_EMAIL', 'tuyensinh@hht.edu.vn', 'STRING', 'Email tuyển sinh', 'Email tuyển sinh', { isPublic: true }),
  C('OFFICIAL_REGISTER_URL', 'https://hht.edu.vn/dang-ky-ho-so-tuyen-sinh-truc-tuyen/', 'STRING', 'Trang đăng ký chính thức', 'Trang đăng ký xét tuyển trực tuyến chính thức', { isPublic: true }),
  C('FANPAGE_URL', 'https://facebook.com/tuyensinh.hht.edu.vn', 'STRING', 'Fanpage', 'Fanpage tuyển sinh', { isPublic: true }),
  C('SUBMISSION_ADDRESS', 'Trung tâm Tuyển sinh & Giải quyết việc làm – Tầng 1 nhà A, Cơ sở 1, Phố Nhuệ Giang, Phường Xuân Phương, TP. Hà Nội', 'STRING', 'Địa chỉ nộp hồ sơ', 'Địa chỉ nộp hồ sơ (hiện trên lịch hẹn)', { isPublic: true }),
  C('CHAT_GREETING', 'Chào bạn! Đây là kênh tư vấn tuyển sinh của Trường Cao đẳng Công nghệ cao Hà Nội. Bạn cần tìm hiểu về ngành học, học phí, hồ sơ hay lịch xét tuyển?', 'STRING', 'Lời chào trợ lý', 'Lời chào đầu cuộc trò chuyện', { isPublic: true }),
  C('HANDOFF_ENABLED', true, 'BOOL', 'Cho gửi câu hỏi cho cán bộ', 'Cho phép thí sinh gửi câu hỏi cho cán bộ', { isPublic: true }),
  C('MESSENGER_ENABLED', false, 'BOOL', 'Kênh Messenger', 'Bật kênh Fanpage Messenger'),
  C('DATA_RETENTION_DAYS', 365, 'INT', 'Lưu dữ liệu chat (ngày)', 'Sau số ngày này nội dung chat được ẩn danh/xóa', { min: 30, max: 3650 }),
  C('ALLOWED_EMBED_ORIGINS', '["https://hht.edu.vn","https://www.hht.edu.vn"]', 'JSON', 'Website được nhúng khung chat', 'Website được nhúng widget chat (iframe)'),
  // --- Gợi ý ngành ---
  ...group('RECOMMEND'),
  C('RECOMMEND_WEIGHTS', '{"riasec":0.6,"subject":0.25,"preference":0.15}', 'JSON', 'Trọng số gợi ý ngành', 'Trọng số chấm điểm gợi ý ngành (tổng = 1)'),
  C('RECOMMEND_TOP_N', 3, 'INT', 'Số ngành gợi ý', 'Số ngành gợi ý', { min: 1, max: 10 }),
  // --- Đặt lịch nộp hồ sơ (M6) – MẪU, chờ trường xác nhận ---
  ...group('APPOINTMENT'),
  C('APPOINTMENT_ENABLED', true, 'BOOL', 'Bật đặt lịch', 'Bật đặt lịch hẹn nộp hồ sơ', { isPublic: true }),
  C('OFFICE_TIME_SLOTS', '08:00-11:30,13:30-16:30', 'STRING', 'Khung giờ tiếp nhận', 'MẪU – Khung giờ tiếp nhận (trường chưa công bố giờ làm việc)'),
  C('OFFICE_WORKING_DAYS', '1,2,3,4,5,6', 'LIST', 'Ngày tiếp nhận', 'MẪU – Ngày tiếp nhận: 1=Thứ Hai … 7=Chủ nhật', { min: 1, max: 7 }),
  C('APPOINTMENT_SLOT_MINUTES', 30, 'INT', 'Độ dài khung hẹn (phút)', 'Độ dài mỗi khung hẹn (phút)', { min: 15, max: 120 }),
  C('APPOINTMENT_CAPACITY_PER_SLOT', 10, 'INT', 'Số lịch mỗi khung', 'Số lịch tối đa mỗi khung', { min: 1, max: 100 }),
  C('APPOINTMENT_DAYS_AHEAD', 14, 'INT', 'Mở lịch trước (ngày)', 'Mở lịch trước bao nhiêu ngày', { min: 1, max: 60 }),
  C('APPOINTMENT_MIN_LEAD_HOURS', 2, 'INT', 'Đặt trước tối thiểu (giờ)', 'Đặt trước tối thiểu (giờ)', { min: 0, max: 72 }),
  C('APPOINTMENT_MAX_ACTIVE_PER_VISITOR', 1, 'INT', 'Số lịch mỗi người', 'Số lịch đang hiệu lực tối đa mỗi người', { min: 1, max: 5 }),
  C('APPOINTMENT_MAX_RESCHEDULE', 2, 'INT', 'Số lần đổi lịch', 'Số lần đổi lịch tối đa', { min: 0, max: 10 }),
  C('APPOINTMENT_REQUIRE_COMPLETE', false, 'BOOL', 'Bắt buộc đủ giấy tờ', 'Bắt buộc đủ giấy bắt buộc mới cho đặt lịch'),
];

const CONFIG_META = Object.freeze(Object.fromEntries(CONFIG_DEFAULTS.map((d) => [d.key, { group: d.group, label: d.label }])));

module.exports = { CONFIG_DEFAULTS, CONFIG_META };
