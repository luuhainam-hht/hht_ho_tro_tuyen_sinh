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
   PostgreSQL (dữ liệu, jobs, NOTIFY)    Groq / Gemini (sinh câu); Gemini (embedding, tra Google, đọc ảnh)
```

## Luồng hỏi đáp (`services/rag/answerService.js`)

Các bước đi từ rẻ và chắc chắn đến đắt và rủi ro:

1. **Chuẩn bị:** kiểm tra phiên trò chuyện, che dữ liệu cá nhân (SĐT, CCCD, email) trước khi lưu log hoặc gửi LLM, rồi chuẩn hóa câu hỏi (bỏ dấu, bỏ hư từ).
2. **Luật:** chào hỏi, câu ngoài phạm vi, nội dung khiếm nhã, nhầm với trường CNH → trả câu mẫu, không tốn token.
3. **FAQ đã duyệt:** khớp theo cosine embedding hoặc theo độ giống từ khóa → trả **nguyên văn** kèm nguồn.
4. **Bộ nhớ đệm:** khóa gồm (hash câu hỏi + mã ngành đang xem, `kb_version`); phiên đã có lịch sử hội thoại không đọc/ghi bộ nhớ đệm. Khi công bố tài liệu hoặc duyệt FAQ, `kb_version` đổi nên cache tự hết hiệu lực.
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

## Phân quyền Phòng Tuyển sinh / Khoa, bảng ngành tách cột, trợ lý tra cứu Internet (bổ sung 17/11/2026)

- **Vai trò mới** (`src/constants/roles.js`, migration `2026-11-17-admission-office-faculty-web`):
  - `ADMISSION_OFFICE` – Phòng Tuyển sinh: ngành của mọi khoa, hồ sơ (trang Hồ sơ), đợt nhận hồ sơ, hướng dẫn, liên hệ, giải thích hệ/học phí, duyệt FAQ, công bố tài liệu, câu hỏi chờ cán bộ, lịch hẹn.
  - `FACULTY` – Cán bộ Khoa: gắn `staff.faculty`; chỉ xem/sửa/thêm ngành của khoa mình (máy chủ ép khoa khi thêm, chặn 403 khi sửa ngành khoa khác hoặc chuyển khoa); soạn FAQ chờ duyệt.
  - Nhóm quyền mới: `MAJOR_MANAGE`, `ADMISSION_INFO`, `CONTACT_CONFIG`. `/api/auth/me` trả `permissions` -> giao diện ẩn/hiện tab theo máy chủ (không còn chép bảng quyền ở frontend).
- **API quản trị** `/api/admin/catalog`: `majors` (GET/POST/PUT, có học phí min–max, % Nhà nước/Doanh nghiệp – chuẩn hóa "70" → "70%", chặn tổng > 100%), `admission-items` (GET/POST/PUT/DELETE cho DOC_CHECKLIST, SCHEDULE, ONLINE_GUIDE_STEP, CONTACT, LEVEL_INFO, SUPPORT_INFO), `contact-configs` (chỉ HOTLINE, email, địa chỉ nộp hồ sơ, trang đăng ký, fanpage, tên trường, lời chào, bật chuyển cán bộ). Mọi thay đổi ghi audit và phát `CATALOG_UPDATED`.
- **Trang Ngành học**: cột "Hệ tuyển sinh" tách SC | Hệ 9+ | TC | CĐ, cột "Hỗ trợ học phí" tách Nhà nước | Doanh nghiệp | Sinh viên (% + số tiền/tháng = học phí × %). Chú thích viết tắt ở trên bảng; bấm tên cột → khung chat hiện giải thích lấy từ `admission_items` kind `LEVEL_INFO`/`SUPPORT_INFO` (`GET /api/handbook/info`, Phòng Tuyển sinh sửa được). Khung chat đang mở nhận lệnh qua `postMessage`, không tải lại.
- **Trợ lý**:
  - *Tri thức sống* (`services/rag/liveKnowledge.js`): dựng đoạn văn bản từ ngành, đợt nhận hồ sơ (trạng thái theo hôm nay), hồ sơ, liên hệ, hướng dẫn, giải thích hệ – trợ lý trả lời theo dữ liệu vừa sửa. Đoạn seed cũ cùng loại bị loại khỏi tìm kiếm (`STALE_SEED_FILTER`). `v_kb_version` gồm `majors`/`admission_items.updated_at` nên cache tự hết hiệu lực.
  - *Có căn cứ*: độ phủ từ khóa phải đạt ngưỡng cả theo đếm thường lẫn theo trọng số IDF toàn kho – chặn "bể bơi ở cơ sở 3" khớp nhầm đoạn Liên hệ.
  - *Tự công bố* (`KB_AUTO_PUBLISH`, mặc định bật): tài liệu tải lên xử lý xong là vào kho trả lời; migration `2026-11-17-publish-ready-documents` công bố một lần các tài liệu READY tồn đọng.
  - *Tra cứu Internet* (`AI_WEB_SEARCH_ENABLED`): kho không đủ căn cứ hoặc AI báo tài liệu thiếu → Gemini + Google Search grounding, ưu tiên hht.edu.vn, chỉ nhận khi có nguồn web thật (`groundingMetadata`); nguồn `WEB`, giao diện ghi chú "chưa phải văn bản chính thức".
  - *Trả lời thẳng*: lời nhắc cấm nhắc lại câu hỏi/mở đầu; nhánh trích nguyên văn bỏ "Theo văn bản…", với đoạn "Hỏi/Đáp" chỉ lấy phần Đáp khớp nhất.
  - *Câu trả lời dài*: khung chat cuộn tới ĐẦU câu trả lời (khi cao hơn 55% khung) và thêm nút "↑ Về đầu câu trả lời".

## Nâng cấp vận hành cho Trường (24/11/2026)

- **Bộ nhớ đệm** (`answerService.cacheKey`): khóa = sha256(câu hỏi chuẩn hóa + `|major:<mã ngành>`). Lý do: truy xuất được bổ sung tên ngành đang xem, nên cùng câu "học phí bao nhiêu?" ở hai trang ngành là hai câu hỏi khác nhau. Lịch sử hội thoại được đọc trước bước cache; có lịch sử thì bỏ qua cache (câu nối tiếp phụ thuộc ngữ cảnh). Migration xóa toàn bộ `answer_cache` cũ.
- **Tra Internet** (`answerService.tryWeb`):
  - Chế độ SCHOOL chỉ giữ nguồn có tên miền thuộc `AI_WEB_ALLOWED_DOMAINS` (`isAllowedSource`: khớp đúng tên miền hoặc tên miền con; URL chuyển hướng của Google thì lấy tên miền ở tiêu đề). Không còn nguồn nào -> FALLBACK.
  - `citation.validateWebAnswer`: câu có con số phải nằm trong một `groundingSupports` của Gemini mà nguồn thuộc tên miền tin cậy; hotline và số trong đoạn tài liệu nội bộ luôn được phép. Còn lại < 30 ký tự -> không dùng.
  - Trace trên trang Thử trợ lý ghi số nguồn bị loại và số câu bị bỏ.
- **Bí mật** (`env.assertProductionSecrets`, gọi trong `server.start`): production thiếu `VISITOR_HASH_SECRET` hoặc để giá trị mẫu -> dừng khởi động (khóa mã hóa tạm sẽ làm mất khóa API sau mỗi lần khởi động lại). `doctor`/`setup` vẫn chạy được để sửa.
- **Giới hạn tần suất** (`rateLimits.js`): `limits.chat` = [`chatIp` 200/phút/IP, `chatSession` 12/phút/(IP + sessionId)]; `api` 600/phút/IP.
- **Lọc câu dò bí mật** (`securityGuard.detectSecretProbe`): danh từ "học thuật" (cơ sở dữ liệu, mã nguồn, lỗ hổng, SQL injection…) được bỏ qua khi câu hỏi nói về việc học (`STUDY_CONTEXT`) và không nhắm vào hệ thống/website của Trường (`SYSTEM_TARGET`). Mật khẩu, khóa API, token, chuỗi kết nối, file .env luôn bị chặn.
- **Mặc định an toàn**: `KB_AUTO_PUBLISH`, `AI_WEB_GENERAL_ENABLED`, `MINDTEK_ENABLED`, `RAG_ALL_YEARS` = false; migration `2026-11-24-safe-defaults-for-production` chỉ đổi dòng có `updated_by IS NULL`.
