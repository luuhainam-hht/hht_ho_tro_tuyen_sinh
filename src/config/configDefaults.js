'use strict';
/**
 * Nguồn DUY NHẤT của danh sách tham số nghiệp vụ. runMigrations upsert metadata mỗi lần khởi động
 * (ON CONFLICT chỉ cập nhật kiểu/biên/mô tả, không ghi đè giá trị Admin đã sửa).
 * Vì sao: bản gốc phải khai báo ở cả schema.sql lẫn runMigrations -> từng quên một bên, get() ném lỗi.
 *
 * Tham số ghi "MẪU" là giá trị tạm do website trường chưa công bố – cần Trung tâm Tuyển sinh xác nhận.
 */
const C = (key, value, type, description, extra = {}) => ({ key, value: String(value), type, description, min: null, max: null, isPublic: false, ...extra });

const CONFIG_DEFAULTS = [
  // --- AI / RAG ---
  C('LLM_MODEL', 'gemini-2.5-flash', 'STRING', 'Tên model sinh câu trả lời (Gemini)'),
  C('EMBEDDING_MODEL', 'gemini-embedding-001', 'STRING', 'Tên model tạo vector embedding'),
  C('EMBEDDING_DIM', 768, 'INT', 'Số chiều vector embedding', { min: 128, max: 3072 }),
  C('LLM_TEMPERATURE', 0.2, 'NUMBER', 'Nhiệt độ sinh câu (thấp = ổn định, ít bịa)', { min: 0, max: 1 }),
  C('RAG_TOP_K', 5, 'INT', 'Số đoạn văn bản đưa vào ngữ cảnh', { min: 1, max: 10 }),
  C('RAG_MIN_SCORE', 0.6, 'NUMBER', 'Cosine tối thiểu để coi là có căn cứ (khi có embedding)', { min: 0, max: 1 }),
  C('RAG_MIN_LEXICAL_SCORE', 0.5, 'NUMBER', 'Độ phủ từ khóa tối thiểu để coi là có căn cứ (khi chưa có embedding)', { min: 0, max: 1 }),
  C('FAQ_MATCH_SCORE', 0.85, 'NUMBER', 'Cosine embedding tối thiểu để trả nguyên văn FAQ', { min: 0, max: 1 }),
  C('FAQ_LEXICAL_MATCH_SCORE', 0.62, 'NUMBER', 'Độ giống từ khóa tối thiểu để trả nguyên văn FAQ', { min: 0, max: 1 }),
  C('MAX_HISTORY_TURNS', 6, 'INT', 'Số lượt hội thoại gần nhất gửi kèm LLM', { min: 0, max: 20 }),
  C('MAX_ANSWER_TOKENS', 800, 'INT', 'Trần token mỗi câu trả lời', { min: 100, max: 4000 }),
  C('DAILY_TOKEN_BUDGET', 400000, 'INT', 'Trần token LLM mỗi ngày (vượt thì chỉ trả lời FAQ/trích văn bản)', { min: 0, max: 100000000 }),
  C('CACHE_TTL_HOURS', 72, 'INT', 'Thời gian giữ cache câu trả lời', { min: 1, max: 720 }),
  C('CURRENT_ADMISSION_YEAR', 2026, 'INT', 'Năm tuyển sinh hiện hành (2026 = năm học 2026–2027)', { min: 2020, max: 2100 }),
  // --- Liên hệ & giao diện (công khai) ---
  C('SCHOOL_NAME', 'Trường Cao đẳng Công nghệ cao Hà Nội', 'STRING', 'Tên trường hiển thị', { isPublic: true }),
  C('HOTLINE', '0981 670 588', 'STRING', 'Hotline tuyển sinh chung (chân trang website trường)', { isPublic: true }),
  C('ADMISSION_EMAIL', 'tuyensinh@hht.edu.vn', 'STRING', 'Email tuyển sinh', { isPublic: true }),
  C('OFFICIAL_REGISTER_URL', 'https://hht.edu.vn/dang-ky-ho-so-tuyen-sinh-truc-tuyen/', 'STRING', 'Trang đăng ký xét tuyển trực tuyến chính thức', { isPublic: true }),
  C('FANPAGE_URL', 'https://facebook.com/tuyensinh.hht.edu.vn', 'STRING', 'Fanpage tuyển sinh', { isPublic: true }),
  C('SUBMISSION_ADDRESS', 'Trung tâm Tuyển sinh & Giải quyết việc làm – Tầng 1 nhà A, Cơ sở 1, Phố Nhuệ Giang, Phường Xuân Phương, TP. Hà Nội', 'STRING', 'Địa chỉ nộp hồ sơ (hiện trên lịch hẹn)', { isPublic: true }),
  C('CHAT_GREETING', 'Chào bạn! Đây là kênh tư vấn tuyển sinh của Trường Cao đẳng Công nghệ cao Hà Nội. Bạn cần tìm hiểu về ngành học, học phí, hồ sơ hay lịch xét tuyển?', 'STRING', 'Lời chào đầu cuộc trò chuyện', { isPublic: true }),
  C('HANDOFF_ENABLED', true, 'BOOL', 'Cho phép thí sinh gửi câu hỏi cho cán bộ', { isPublic: true }),
  C('MESSENGER_ENABLED', false, 'BOOL', 'Bật kênh Fanpage Messenger'),
  C('DATA_RETENTION_DAYS', 365, 'INT', 'Sau số ngày này nội dung chat được ẩn danh/xóa', { min: 30, max: 3650 }),
  C('ALLOWED_EMBED_ORIGINS', '["https://hht.edu.vn","https://www.hht.edu.vn"]', 'JSON', 'Website được nhúng widget chat (iframe)'),
  // --- Gợi ý ngành ---
  C('RECOMMEND_WEIGHTS', '{"riasec":0.6,"subject":0.25,"preference":0.15}', 'JSON', 'Trọng số chấm điểm gợi ý ngành (tổng = 1)'),
  C('RECOMMEND_TOP_N', 3, 'INT', 'Số ngành gợi ý', { min: 1, max: 10 }),
  // --- Đặt lịch nộp hồ sơ (M6) – MẪU, chờ trường xác nhận ---
  C('APPOINTMENT_ENABLED', true, 'BOOL', 'Bật đặt lịch hẹn nộp hồ sơ', { isPublic: true }),
  C('OFFICE_TIME_SLOTS', '08:00-11:30,13:30-16:30', 'STRING', 'MẪU – Khung giờ tiếp nhận (trường chưa công bố giờ làm việc)'),
  C('OFFICE_WORKING_DAYS', '1,2,3,4,5,6', 'LIST', 'MẪU – Ngày tiếp nhận: 1=Thứ Hai … 7=Chủ nhật', { min: 1, max: 7 }),
  C('APPOINTMENT_SLOT_MINUTES', 30, 'INT', 'Độ dài mỗi khung hẹn (phút)', { min: 15, max: 120 }),
  C('APPOINTMENT_CAPACITY_PER_SLOT', 10, 'INT', 'Số lịch tối đa mỗi khung', { min: 1, max: 100 }),
  C('APPOINTMENT_DAYS_AHEAD', 14, 'INT', 'Mở lịch trước bao nhiêu ngày', { min: 1, max: 60 }),
  C('APPOINTMENT_MIN_LEAD_HOURS', 2, 'INT', 'Đặt trước tối thiểu (giờ)', { min: 0, max: 72 }),
  C('APPOINTMENT_MAX_ACTIVE_PER_VISITOR', 1, 'INT', 'Số lịch đang hiệu lực tối đa mỗi người', { min: 1, max: 5 }),
  C('APPOINTMENT_MAX_RESCHEDULE', 2, 'INT', 'Số lần đổi lịch tối đa', { min: 0, max: 10 }),
  C('APPOINTMENT_REQUIRE_COMPLETE', false, 'BOOL', 'Bắt buộc đủ giấy bắt buộc mới cho đặt lịch'),
];

module.exports = { CONFIG_DEFAULTS };
