# HHT Tuyển sinh AI

Hệ thống trợ lý ảo AI tư vấn tuyển sinh của **Trường Cao đẳng Công nghệ cao Hà Nội**. Đây là sản phẩm của giải pháp đổi mới sáng tạo cấp Trường năm học 2025–2026 do Khoa Công nghệ Thông tin thực hiện, với đề tài *"Ứng dụng trí tuệ nhân tạo nâng cao hiệu quả công tác tư vấn và tuyển sinh"*.

| Mô-đun | Trang / API | Nội dung |
|---|---|---|
| M1 Trợ lý ảo 24/7 | nút "Hỏi trợ lý" ở mọi trang, `chat.html`, `widget.js` | Trả lời lần lượt theo luật → FAQ đã duyệt → bộ nhớ đệm → truy xuất văn bản → LLM. Mọi câu trả lời đều dẫn nguồn. |
| M2 Kho tri thức | Admin › Kho tri thức | Tải văn bản PDF/DOCX/TXT, hệ thống chia đoạn và tạo vector. Lãnh đạo bấm công bố thì trợ lý mới dùng; có phiên bản theo năm. |
| M3 Cẩm nang số | `nganh.html`, `ho-so.html`, `lich-tuyen-sinh.html`, `huong-dan-dang-ky.html`, `cam-nang.html`, `lien-he.html` | Tra cứu ngành, checklist hồ sơ có thể in, lịch xét tuyển, các bước đăng ký. |
| M4 Gợi ý ngành | `goi-y-nganh.html` | Trắc nghiệm Holland RIASEC 18 câu, tự đánh giá môn học và mong muốn. Trả về top 3 ngành kèm điểm từng phần và lý do. |
| M5 Thống kê | Admin › Tổng quan | Câu hỏi theo ngày/giờ, tỉ lệ từng nguồn trả lời, top chủ đề/ngành, câu chưa trả lời được (gom cụm), độ trễ, token, xuất Excel. |
| M6 Đặt lịch nộp hồ sơ | `dat-lich.html`, `hen.html`, Admin › Lịch hẹn | Thí sinh nhận mã hẹn (không phải số thứ tự), đổi/hủy lịch, tải tệp .ics. Cán bộ check-in và xác nhận đã nhận hồ sơ. |
| Chuyển cán bộ | Admin › Câu hỏi chờ cán bộ | Thí sinh đồng ý để lại liên hệ → cán bộ trả lời → có thể "Đưa vào FAQ" để Lãnh đạo duyệt. |

## Chạy trên Windows (khuyên dùng)

Nhấp đúp **`hht-tuyen-sinh.bat`** để mở menu:

| Mục | Việc làm |
|---|---|
| 1. Cài đặt và tự sửa lỗi | Kiểm tra Node.js ≥ 20.10; cài thư viện (lỗi thì tự xóa `node_modules` rồi cài lại); tạo `.env` có hỏi từng mục; tự tạo CSDL nếu chưa có; tạo bảng và nạp dữ liệu |
| 2. Chạy hệ thống | Kiểm tra lỗi, đề nghị tắt chương trình đang chiếm cổng, mở trình duyệt |
| 3. Kiểm tra lỗi môi trường | Chỉ ra lỗi CSDL (chưa chạy, sai mật khẩu, thiếu CSDL, SSL), `.env`, cổng, thư mục tải lên – kèm cách sửa |
| 4. Chạy kiểm thử | Dùng CSDL riêng `<tên>_test` (tự tạo), không đụng dữ liệu thật |
| 5–6. Docker | Chỉ chạy PostgreSQL, hoặc chạy toàn bộ (db, app, HTTPS, sao lưu) |
| 7. Đặt lại mật khẩu admin | In mật khẩu tạm, bắt đổi khi đăng nhập |
| 8. Đẩy lên GitHub | Khởi tạo Git, gắn kho `luuhainam-hht/hht_ho_tro_tuyen_sinh`, kiểm tra cú pháp, commit, gộp thay đổi trên GitHub rồi push. Không bao giờ đẩy `.env` và `data/` |

Có thể gọi thẳng: `hht-tuyen-sinh.bat install | start | test | doctor | push | docker`.

Hai công cụ cơ sở dữ liệu (cần Docker Desktop, không cần cài PostgreSQL):

- **`dong-bo-neon-docker.bat`**: xem trạng thái hai bên; kéo dữ liệu Neon → Docker; đẩy Docker → Neon; sao lưu; khôi phục. Trước mỗi lần ghi đè đều sao lưu bên bị ghi vào `backups/`. Dữ liệu được nạp trong một transaction, lỗi giữa chừng thì bên đích giữ nguyên.
- **`cap-nhat-database-docker.bat`**: cập nhật bảng và nạp dữ liệu còn thiếu (giữ chỉnh sửa của cán bộ); ghi đè dữ liệu tuyển sinh bằng bản mới nhất của dự án; nhập lại file Excel dữ liệu rồi ghi đè; đặt lại mật khẩu quản trị trong Docker.

## Chạy nhanh (dòng lệnh)

```bash
npm ci
npm run setup              # tạo .env (hỏi CSDL, mật khẩu quản trị)
npm run doctor -- --fix     # kiểm tra & tự sửa (tạo CSDL nếu thiếu)
npm start                   # tự tạo bảng, nạp dữ liệu tuyển sinh, mở http://localhost:3000
```

- **Trang quản trị:** `http://localhost:3000/admin.html`. Đăng nhập lần đầu bằng `admin` / `ADMIN_INITIAL_PASSWORD`, hệ thống sẽ bắt đổi mật khẩu.
- **Chưa có `GEMINI_API_KEYS`:** trợ lý vẫn trả lời đầy đủ bằng FAQ đã duyệt và trích nguyên văn văn bản, chỉ không dùng LLM.
- **Docker trên VPS:** `docker compose up -d --build` dựng 4 dịch vụ db (PostgreSQL), app, caddy (HTTPS tự động) và backup (pg_dump hằng ngày).
- **Render + Neon:** dùng `render.yaml`.
- **Nhúng vào website trường:** thêm `<script src="https://<tên-miền-hệ-thống>/widget.js" async></script>` vào trang, rồi thêm tên miền website vào tham số `ALLOWED_EMBED_ORIGINS` trong Admin.

## Dữ liệu

Dữ liệu tuyển sinh thật lấy từ file `docs/HHT_du_lieu_chatbot_tuyen_sinh.xlsx` do nhóm đề tài thu thập ngày 14/11/2026. File này được chuyển thành `db/seed/*.json` bằng lệnh `npm run import:excel -- <file.xlsx>`. Khi nạp, hệ thống áp dụng các quy tắc sau:

- **Câu hỏi – đáp:** 48 câu. Độ tin cậy A, B, D được duyệt sẵn. Độ tin cậy C (Q19, Q24) nạp ở trạng thái **chờ duyệt** vì các nguồn mâu thuẫn nhau.
- **Ngành:** 43 ngành. Mức hỗ trợ học phí của từng ngành luôn gắn nhãn "cần xác minh" và **không** đưa vào kho trả lời của trợ lý, vì bảng ngành 03/2026 và 08/2026 khác nhau.
- **Nguồn:** 22 nguồn. Nguồn đã cũ và nguồn ngoài (S21, S22) chỉ để đối chiếu, trợ lý không dùng để trả lời.
- **Dữ liệu tự gán:** hồ sơ RIASEC và mô tả ngành do nhóm đề tài gán để chạy thử gợi ý ngành (cột `profile_is_sample`), cần chuyên gia hướng nghiệp rà soát.
- **Giá trị MẪU:** giờ tiếp nhận và khung giờ hẹn (`OFFICE_TIME_SLOTS`) là giá trị mẫu vì website trường chưa công bố. Sửa trong Admin › Cấu hình.

Danh sách 16 điểm cần Nhà trường xác minh nằm ở `docs/DU-LIEU.md`.

## Trang quản trị: cài đặt AI và tài khoản

Chỉ tài khoản **Quản trị hệ thống** thấy hai mục này.

**Cài đặt AI** (`/admin.html` › Cài đặt AI):

- Bật/tắt AI tạo sinh. Khi tắt, trợ lý vẫn trả lời bằng câu hỏi thường gặp và trích nguyên văn tài liệu.
- Khóa API Gemini: thêm, kiểm tra, tạm tắt, đổi tên, xóa ngay trên giao diện, không cần sửa `.env` hay khởi động lại. Khóa được mã hóa AES-256-GCM trước khi lưu; giao diện chỉ hiện 4 ký tự đầu và cuối. Khóa trong `.env` vẫn dùng song song.
- Mô hình trả lời, mô hình dự phòng (tự chuyển khi mô hình chính lỗi), độ sáng tạo, thời gian chờ, độ dài tối đa, số lượt hội thoại nhớ, ngân sách token mỗi ngày.
- Cách trả lời: tên trợ lý (hiện trên khung chat), giọng văn, số từ tối đa, lời chào, hướng dẫn bổ sung của Nhà trường. Quy tắc chống bịa số liệu luôn đứng trước hướng dẫn bổ sung; nút "Xem lời nhắc gửi AI" hiện đúng nội dung gửi đi.
- Ngưỡng tìm tài liệu và khớp câu hỏi thường gặp, bật/tắt và thời gian giữ bộ nhớ đệm, nút xóa bộ nhớ đệm.
- Thử trợ lý: hỏi một câu, xem câu trả lời và từng bước xử lý (điểm khớp FAQ, đoạn tài liệu tìm được, mô hình đã dùng, lý do không dùng AI). Không ghi vào lịch sử hội thoại.
- Biểu đồ token 14 ngày, tỉ lệ câu trả lời do AI soạn.

**Tài khoản cán bộ**:

- Tạo tài khoản với mật khẩu tạm ngẫu nhiên hoặc mật khẩu tự đặt.
- Với từng tài khoản: đặt mật khẩu mới (có nút tạo ngẫu nhiên, tùy chọn bắt đổi ở lần đăng nhập sau), cấp mật khẩu tạm, gỡ tạm khóa do nhập sai, đăng xuất khỏi mọi thiết bị, khóa/mở tài khoản. Mọi thao tác ghi nhật ký.
- Chính sách: độ dài mật khẩu tối thiểu, thời hạn phiên đăng nhập, số lần nhập sai trước khi khóa, thời gian tạm khóa.
- Mọi cán bộ tự đổi mật khẩu bằng nút "Đổi mật khẩu" ở góc trên.

## Kiểm thử

```bash
TEST_DATABASE_URL=postgres://…/hht_test npm test   # 52 test: unit + tích hợp với PostgreSQL thật (CSDL tên phải có chữ "test")
npm run eval:rag                                # đánh giá trợ lý theo test/eval/golden.jsonl (CSV + tóm tắt)
npm run report -- 2027-01-01 2027-04-30         # xuất số liệu thử nghiệm ra Excel cho báo cáo tổng kết
```

Xem thêm: `docs/KIEN-TRUC.md` (kiến trúc, luồng, quyết định thiết kế) và `docs/DU-LIEU.md` (nguồn dữ liệu, điểm cần xác minh).
