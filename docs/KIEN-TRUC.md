# Kiến trúc HHT Tuyển sinh AI

## Tổng thể

Hệ thống là một tiến trình Node.js 20 (CommonJS, Express 4) đảm nhận cùng lúc REST API, WebSocket (chung cổng) và frontend tĩnh trong `public/`. Dữ liệu nằm trong một PostgreSQL 14+ (chạy được trên Neon). Hệ thống không dùng Redis và không dùng vector DB riêng, để khớp với ngân sách 10.000.000 đ/năm. Có thể chạy nhiều bản song song: các bản chạy liên lạc với nhau qua `LISTEN/NOTIFY` (kênh `hht_ts_realtime`).

```
Trình duyệt / widget / Messenger
        │ HTTPS + WS
   ┌────▼──────────────────────────────────────────────────────┐
   │ server.js: helmet(CSP) → chặn origin → cors → json → rate-limit
   │            → route cụ thể → '/api' trần (sau cùng) → static → 404 → lỗi
   │ routes/*  (mỏng: validate → service → {error})
   │ services/* (máy trạng thái, RAG, gợi ý ngành, thống kê, đặt lịch)
   │ repositories/* (mọi hàm nhận (client, …) để dùng chung transaction)
   │ config/db.js (placeholder ?, retry lỗi kết nối, withTransaction chạy lại cả khối)
   └────┬───────────────────────────────┬──────────────────────┘
        │ SQL                            │ HTTPS
   PostgreSQL (dữ liệu, jobs, NOTIFY)    Gemini (sinh câu + embedding, nhiều key xoay vòng)
```

## Luồng hỏi đáp (`services/rag/answerService.js`)

Các bước đi từ rẻ và chắc chắn đến đắt và rủi ro:

1. **Chuẩn bị:** kiểm tra phiên trò chuyện, che dữ liệu cá nhân (SĐT, CCCD, email) trước khi lưu log hoặc gửi LLM, rồi chuẩn hóa câu hỏi (bỏ dấu, bỏ hư từ).
2. **Luật:** chào hỏi, câu ngoài phạm vi, nội dung khiếm nhã, nhầm với trường CNH → trả câu mẫu, không tốn token.
3. **FAQ đã duyệt:** khớp theo cosine embedding hoặc theo độ giống từ khóa → trả **nguyên văn** kèm nguồn.
4. **Bộ nhớ đệm:** khóa gồm (hash câu hỏi, `kb_version`). Khi công bố tài liệu hoặc duyệt FAQ, `kb_version` đổi nên cache tự hết hiệu lực.
5. **Truy xuất lai:** full-text (tsvector, không dấu) top 20 + vector top 20, gộp bằng Reciprocal Rank Fusion, lấy `RAG_TOP_K` đoạn.
6. **Không đủ căn cứ** (cosine < `RAG_MIN_SCORE` và độ phủ từ khóa < `RAG_MIN_LEXICAL_SCORE`) → FALLBACK: báo hotline và gợi ý gửi câu hỏi cho cán bộ. **Không gọi LLM.**
7. **Gọi LLM:** prompt nghiêm ngặt, ngữ cảnh đặt trong khối phân tách để chống prompt injection, yêu cầu trả JSON.
8. **Kiểm tra trích dẫn bằng mã (`citation.js`):** gỡ `[n]` không trỏ tới đoạn có thật; bỏ câu có con số không xuất hiện trong đoạn được trích; phần còn lại quá ít thì coi là không đủ căn cứ.
9. **Không có LLM** (chưa có key, hết ngân sách token, lỗi) → trích nguyên văn đoạn có độ phủ tốt nhất, vẫn kèm nguồn.

## Máy trạng thái

| Đối tượng | Trạng thái |
|---|---|
| Tài liệu kho tri thức | DRAFT → PROCESSING → READY → PUBLISHED → ARCHIVED (FAILED khi trích xuất lỗi) |
| FAQ | DRAFT → APPROVED → ARCHIVED. Sửa nội dung một FAQ đã duyệt thì nó quay về DRAFT. |
| Câu hỏi chuyển cán bộ | NEW → ASSIGNED → ANSWERED → CLOSED |
| Lịch hẹn | BOOKED → CHECKED_IN → COMPLETED; BOOKED → CANCELLED hoặc NO_SHOW |
| Việc nền | QUEUED → RUNNING → DONE / FAILED (tối đa 3 lần thử, backoff 30s × 2ⁿ) |

Mọi chuyển trạng thái đi theo cùng một trình tự: `withTransaction` → `SELECT … FOR UPDATE` → kiểm tra trạng thái nguồn → cập nhật (`RETURNING *`, whitelist cột) → ghi history/`audit_logs` → COMMIT → `broadcast`.

## Quyết định thiết kế

- **Không dùng pgvector bắt buộc.** Embedding lưu dạng `REAL[]`; cosine tính trong Node trên cache theo `kb_version`. Kho của một trường chỉ vài nghìn đoạn nên cách này đủ nhanh. Khi vượt khoảng 50.000 đoạn mới cần chuyển sang pgvector + HNSW, và chữ ký `retriever.retrieve()` giữ nguyên.
- **Không dùng unaccent.** Chuẩn hóa tiếng Việt làm ở Node (cột `content_norm`). Hư từ so khớp ở dạng có dấu để không gộp "có" với "cơ", "thì" với "thi".
- **Việc nền lưu trong DB.** Bảng `jobs` dùng `SKIP LOCKED` và `dedupe_key` theo ngày, nên restart hay chạy nhiều bản cũng không mất việc và không chạy trùng. Đây là cải tiến so với timer lưu trong RAM của bản gốc.
- **Tham số nghiệp vụ có một nguồn duy nhất** (`config/configDefaults.js`). Mỗi lần khởi động chỉ thêm khóa mới và cập nhật metadata, không ghi đè giá trị Admin đã sửa.
- **Chống đặt vượt chỗ** bằng hai lớp: khóa dòng slot và `CHECK (booked_count <= capacity)`. Khi đổi lịch, hai slot được khóa theo thứ tự id tăng dần để tránh deadlock. Mã hẹn bị trùng thì thử lại trong SAVEPOINT.
- **Bảo mật:** CSP chặt (không script, style hay onclick nội tuyến). `frame-ancestors` của `chat.html` lấy từ `ALLOWED_EMBED_ORIGINS`. Token phiên chỉ lưu dạng băm. WebSocket chỉ gửi sự kiện nội bộ cho socket đã xác thực. `visitor_hash` là HMAC theo ngày, không lưu IP.

## Cài đặt AI và quản lý tài khoản trên giao diện (bổ sung 11/2026)

- **Khóa API trong CSDL** (`ai_api_keys`): mã hóa AES-256-GCM (`src/utils/secretBox.js`), khóa mã hóa suy ra từ `SECRET_ENCRYPTION_KEY` (mặc định `VISITOR_HASH_SECRET`). Lưu thêm SHA-256 để chống trùng và 4 ký tự đầu/cuối để nhận diện. API không bao giờ trả `key_cipher`.
- **Nạp lại không khởi động lại:** thêm/sửa/xóa khóa → `aiKeyService.reload()` dựng lại key pool (giữ trạng thái nghỉ của khóa cũ) → phát `AI_KEYS_UPDATED` qua pgBus để các bản chạy khác nạp lại.
- **Tham số AI đọc mỗi lần gọi** (`configService.getOr`): `AI_ENABLED`, `LLM_MODEL`, `LLM_FALLBACK_MODEL`, `LLM_TIMEOUT_SECONDS`, `AI_TONE`, `AI_ANSWER_MAX_WORDS`, `AI_EXTRA_INSTRUCTIONS`, `AI_CACHE_ENABLED`, `AI_RECOMMEND_EXPLAIN`… Lỗi 404 (sai tên mô hình) xếp vào lỗi yêu cầu nên không làm khóa bị "nghỉ" oan, rồi chuyển sang mô hình dự phòng.
- **Lời nhắc:** quy tắc chống bịa luôn đứng trước "Hướng dẫn bổ sung của Nhà trường" và được ghi rõ là ưu tiên cao hơn; câu trả lời vẫn qua bước kiểm tra trích dẫn bằng mã như trước.
- **Thử trợ lý** (`POST /api/admin/ai/try`): chạy `answerService.compose` với `dryRun` (không đọc/ghi bộ nhớ đệm, không lấy lịch sử, không ghi log) và `trace` ghi từng bước.
- **Tài khoản:** `set-password` (không áp dụng cho chính mình để phiên bị đánh cắp không chiếm được tài khoản Admin), `unlock`, `logout-all`; chính sách `PASSWORD_MIN_LENGTH`, `SESSION_TTL_HOURS`, `LOGIN_MAX_FAILED_ATTEMPTS`, `LOGIN_LOCK_MINUTES` trong `system_configs`. Cột mới `staff.last_login_at`, `staff.password_changed_at` (migration `2026-11-16-staff-login-tracking`).
