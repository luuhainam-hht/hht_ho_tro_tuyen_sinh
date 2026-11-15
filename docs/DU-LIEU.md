# Dữ liệu tuyển sinh và các điểm cần xác minh

Nguồn: bộ dữ liệu nhóm đề tài thu thập ngày 14/11/2026 (`docs/HHT_du_lieu_chatbot_tuyen_sinh.xlsx`).

## Quy ước độ tin cậy

- **A**: lấy trực tiếp từ thông báo tuyển sinh chính thức 2026–2027. Nạp ở trạng thái đã duyệt.
- **B**: lấy từ bài tin hoặc trang giới thiệu, chưa có văn bản gốc đối chiếu. Nạp ở trạng thái đã duyệt, nên rà lại.
- **C**: các nguồn mâu thuẫn nhau. Nạp ở trạng thái **chờ duyệt**, trợ lý chưa dùng.
- **D**: website không có thông tin. Câu trả lời chỉ hướng dẫn thí sinh liên hệ.

## Điểm cần Nhà trường xác minh

| Mã | Chủ đề | Vấn đề | Mức | Đề xuất |
|---|---|---|---|---|
| V01 | Địa chỉ | Trang Liên hệ ghi địa chỉ chính "Tây Mỗ, Nam Từ Liêm"; thông báo 2025–2026 ghi địa chỉ cũ (Tây Mỗ, Trung Văn, Mỹ Đình I – Nam Từ Liêm); các trang 2026 ghi Xuân Phương, Thanh Xuân, Từ Liêm. Ảnh thông báo 2026–2027 ghi nhầm "Phường Tứ Liêm". | Trung bình | Chatbot dùng địa chỉ mới; có thể kèm địa chỉ cũ để người dùng tra bản đồ. |
| V02 | Đợt nhập học | Thông báo chính 2026–2027: 4 đợt (01/01–30/03; 01/05–31/08; 01/09–31/10; 01/11–31/12), bỏ trống tháng 4. Thông báo bộ đội xuất ngũ: 3 đợt (01/03–31/08; 01/09–31/10; 01/11–31/12). Các bài tin lại có đợt tháng 7, 8, 9 riêng. | Cao | Trường cần chốt 1 lịch chính thức cho chatbot. |
| V03 | Hỗ trợ học phí | Bảng ngành 03/2026 và bảng 08/2026 khác nhau: Công nghệ ô tô (70% → không ghi), Cơ điện tử (DN 30% → không ghi), Chế tạo khuôn mẫu (DN 100% → không ghi), Công nghệ Hàn (DN – → 30%), Chăn nuôi thú y (DN – → 30%). Bài 07/2026 vẫn ghi ô tô được hỗ trợ 70%. | Cao | Xác nhận mức hỗ trợ hiện hành trước khi đưa vào chatbot; tạm thời chatbot nên nói "một số ngành" và mời liên hệ. |
| V04 | Ngành tuyển sinh | Bảng ngành 08/2026 không còn các nghề Điện – Điện tử (Điện công nghiệp, Điện tử CN, Máy lạnh, Tự động hóa, Bán dẫn, Thang máy…) và Quản trị khách sạn/nhà hàng; 2 dòng Sửa chữa máy tính, Quản trị mạng không đánh dấu hệ nào. Có thể do hết chỉ tiêu đợt tháng 9, nhưng ảnh không ghi lý do. | Cao | Hỏi Trung tâm Tuyển sinh: các nghề này còn tuyển cho đợt 4 (11–12/2026) không. |
| V05 | Ngành tuyển sinh | "Công nghệ kỹ thuật cơ khí" được công bố là nghề mới và được hỗ trợ 70% nhưng không có trong bảng ngành, không có mã nghề. Biểu mẫu online có thêm các nghề không có trong bảng: Bảo dưỡng sửa chữa máy CNC, Tự động hóa công nghiệp, Phát triển ứng dụng di động, Cơ – Điện nông nghiệp, Quản trị mạng máy tính. | Trung bình | Đồng bộ danh mục nghề giữa thông báo, biểu mẫu online và trang ngành học. |
| V06 | Mã nghề | Du lịch sinh thái/Hướng dẫn du lịch: 5810102 (03/2026) vs 6810103 (08/2026). Thông báo 2025–2026 ghi Tiếng Trung trùng mã 6220206 với Tiếng Anh. Một số dòng ghi "CDD0118" (mã trường) thay cho mã nghề. | Thấp | Không đưa mã nghề vào câu trả lời chatbot cho đến khi được xác nhận. |
| V07 | Hệ 9+ | Tiêu đề ghi "song bằng THPT + Cao đẳng" nhưng sau 3 năm học sinh nhận bằng THPT + Trung cấp; bằng Cao đẳng cần học thêm năm thứ 4. Tiếng Nhật và Chăn nuôi thú y có chỉ tiêu 9+ nhưng bảng ngành 03/2026 không đánh dấu hệ 9+. | Trung bình | Chatbot phải nói rõ lộ trình 3 + 1 năm. |
| V08 | Văn bản miễn giảm | Thông báo chính 2026–2027 ghi Nghị định 238/2025/NĐ-CP; thông báo bộ đội xuất ngũ ghi Nghị định 81/2021/NĐ-CP. | Trung bình | Thống nhất theo văn bản đang có hiệu lực. |
| V09 | Hệ đặt hàng | Bài 07/2026 ghi sinh viên được hỗ trợ "100% học phí" và "70–100% học phí" trong cùng bài. Thông báo 2025–2026 ghi DN hỗ trợ 30–100%, "từ 3–10 triệu đồng/tháng". | Trung bình | Chatbot dùng "70–100%" và nói rõ nộp trước, được hoàn lại sau khi trúng tuyển. |
| V10 | Hotline | Danh sách hotline khác nhau: Cô My 0988 645 044 (2025–2026) vs 0857 974 156 (2026–2027); Cô Hằng 0912 534 581 chỉ có ở 2025–2026; 0974 735 885 không ghi tên; thông báo 9+ ghi 0981 670 588 là số Cô Thương, 0981 667 288 là số Cô Lan Phương. | Trung bình | Trường xác nhận danh sách hotline hiện hành. |
| V11 | Email | Có 3 email: tuyensinh@hht.edu.vn, caodangcongnghecaohanoi@hht.edu.vn, contact@hht.edu.vn. | Thấp | Chatbot ưu tiên tuyensinh@ cho câu hỏi tuyển sinh. |
| V12 | Website | Menu "Tuyển sinh Cao đẳng, Trung cấp" vẫn trỏ về thông báo 2025–2026. Link "Thông tin học bổng" dẫn sang trang giới thiệu Trung tâm Tuyển sinh. Trang ngành học: mục "Kế toán doanh nghiệp" trỏ vào URL tiếng Anh du lịch. Trang đăng ký online ghi "mẫu hồ sơ 2025". Phần chữ của thông báo 2026–2027 bị cắt, nội dung chỉ có trong ảnh. | Trung bình | Báo bộ phận quản trị web sửa. Nội dung trong ảnh nên có thêm bản chữ để máy tìm kiếm và chatbot đọc được. |
| V13 | Ký túc xá | Không có thông tin giá, loại phòng, số chỗ, quy trình, hồ sơ đăng ký, nội quy KTX trên website. | Cao | Trường cung cấp văn bản chính thức (quy định nội trú, bảng phí) để bổ sung. |
| V14 | Học phí | Chỉ có khoảng 1,8–2,4 triệu/tháng, không có bảng học phí từng ngành, không có lệ phí xét tuyển, không có các khoản thu khác (BHYT, đồng phục…). Học phí ngắn hạn trên web là từ năm 2019. | Cao | Bổ sung bảng học phí và các khoản thu đầu khóa năm 2026–2027. |
| V15 | Chương trình nước ngoài | Báo GDVN (07/2026) nêu website quảng bá mô hình 3+2, 1+1+4… với trường Hàn Quốc; Hiệu trưởng trả lời đó chỉ là lộ trình học tập, không phải liên kết đào tạo cấp bằng. | Cao | Chatbot không dùng các từ "song bằng", "liên kết cấp bằng đại học Hàn Quốc"; chỉ nói "định hướng, trao đổi sinh viên" và mời liên hệ. |
| V16 | Nguồn bên ngoài | Tuyensinh247 trộn thông tin HHT với "Cao đẳng Công nghệ Hà Nội" (mã CNH, tư thục). | Trung bình | Không dùng làm nguồn. Chatbot có thể cảnh báo người dùng tránh nhầm 2 trường. |

## Nguồn

| Mã | Văn bản | Ngày | Dùng để trả lời |
|---|---|---|---|
| S01 | [Thông báo tuyển sinh năm học 2026 – 2027 (kèm 6 ảnh thông báo anh-1 đến anh-6)](https://hht.edu.vn/tuyen-sinh/thong-bao-tuyen-sinh-nam-hoc-2026-2027/) | Đăng 11/03/2026, cập nhật 07/05/2026 | Có |
| S02 | [Thông báo tuyển sinh năm học 2026 – 2027 vào lớp 10 (hệ 9+), kèm 2 ảnh văn bản có chữ ký Hiệu trưởng](https://hht.edu.vn/tuyen-sinh/39012/) | Đăng 24/02/2026, cập nhật 25/02/2026 | Có |
| S03 | [Thông báo tuyển sinh năm học 2026 – 2027 dành cho Bộ đội xuất ngũ, Công an xuất ngũ](https://hht.edu.vn/thong-bao-vi/thong-bao-tuyen-sinh-nam-hoc-2026-2027-danh-cho-doi-tuong-bo-doi-xuat-ngu-cong-an-xuat-ngu/) | Đăng 01/12/2025 | Có |
| S04 | [Hà Nội hỗ trợ 100% học phí, mở rộng cơ hội học nghề chất lượng cao](https://hht.edu.vn/tuyen-sinh/ha-noi-ho-tro-100-hoc-phi-mo-rong-co-hoi-hoc-nghe-chat-luong-cao/) | Đăng 09/09/2026 | Có |
| S05 | [Tuyển sinh tháng 9/2026: Cơ hội học nghề chất lượng cao tại HHT (kèm 3 ảnh)](https://hht.edu.vn/tuyen-sinh/tuyen-sinh-thang-9-2026-co-hoi-hoc-nghe-chat-luong-cao-tai-hht/) | Đăng 27/08/2026 | Có |
| S06 | [Tháng 8 – Thời điểm vàng lựa chọn tương lai: tuyển sinh đợt mới năm 2026](https://hht.edu.vn/tuyen-sinh/thang-8-thoi-diem-vang-lua-chon-tuong-lai-truong-cao-dang-cong-nghe-cao-ha-noi-tuyen-sinh-dot-moi-nam-2026/) | Đăng 29/07/2026 | Có |
| S07 | [HHT nhận hồ sơ xét tuyển, đợt nhập học tháng 7 (từ 15/7 – 31/7/2026)](https://hht.edu.vn/tuyen-sinh/hht-nhan-ho-so-xet-tuyen-dot-nhap-hoc-thang-7-tu-15-7-31-7-2026/) | Đăng 13/07/2026 | Có |
| S08 | [Chương trình tuyển dụng "Kĩ sư thực hành" khoá 8 HHT – Hanwha Aero Engines (kèm 2 ảnh)](https://hht.edu.vn/tuyen-sinh/chuong-trinh-tuyen-dung-ki-su-thuc-hanh-khoa-8-hht-hanwha-aero-engines/) | Đăng 12/06/2026 | Có |
| S09 | [Thông báo tuyển sinh năm học 2025 – 2026](https://hht.edu.vn/tuyen-sinh/thong-bao-tuyen-sinh-nam-hoc-2025-2026/) | Đăng 06/02/2025, cập nhật 08/09/2025 | Không (chỉ đối chiếu) |
| S10 | [Đăng ký hồ sơ tuyển sinh trực tuyến (biểu mẫu)](https://hht.edu.vn/dang-ky-ho-so-tuyen-sinh-truc-tuyen/) | Không ghi ngày | Có |
| S11 | [Giới thiệu Trung tâm Ký túc xá](https://hht.edu.vn/trung-tam-hht/gioi-thieu-trung-tam-ki-tuc-xa/) | Đăng 26/02/2024 | Có |
| S12 | [Giới thiệu Trung tâm Tuyển sinh & Giải quyết việc làm](https://hht.edu.vn/trung-tam-hht/gioi-thieu-trung-tam-tuyen-sinh-giai-quyet-viec-lam/) | Đăng 26/02/2025 | Có |
| S13 | [Trang Liên hệ](https://hht.edu.vn/lien-he/) | Không ghi ngày | Có |
| S14 | [Lịch sử hình thành](https://hht.edu.vn/gioi-thieu/tong-quan/lich-su-hinh-thanh/) | Không ghi ngày | Có |
| S15 | [Danh mục các nghề tuyển sinh (trang ngành học)](https://hht.edu.vn/nganh-hoc/) | Không ghi ngày | Có |
| S16 | [Chuyên mục Tuyển sinh liên thông](https://hht.edu.vn/tuyen-sinh/tuyen-sinh-lien-thong/) | Bài mới nhất 06/06/2023 | Không (chỉ đối chiếu) |
| S17 | [Chuyên mục Tuyển sinh du học nghề](https://hht.edu.vn/tuyen-sinh/tuyen-sinh-du-hoc-nghe/) | Bài mới nhất 13/06/2024 | Không (chỉ đối chiếu) |
| S18 | [Tuyển sinh ngắn hạn – danh mục nghề và mức học phí lớp ngắn hạn](https://hht.edu.vn/tuyen-sinh/tuyen-sinh-ngan-han-danh-muc-cac-nghe-dao-tao-ngan-han-va-muc-hoc-phi-cac-lop-ngan-han-cap-chung-chi/) | Đăng 28/05/2019, cập nhật 16/12/2019 | Không (chỉ đối chiếu) |
| S19 | [Từ trường cao đẳng chất lượng cao đến Trung tâm Quốc gia: HHT xác lập bước phát triển mới](https://hht.edu.vn/goc-nhin-hht/tu-truong-cao-dang-chat-luong-cao-den-trung-tam-quoc-gia-hht-xac-lap-buoc-phat-trien-moi/) | Đăng 17/09/2026 | Có |
| S20 | [Trang chủ hht.edu.vn (menu, chân trang)](https://hht.edu.vn/) | Truy cập 14/11/2026 | Có |
| S21 | [Báo Giáo dục Việt Nam: Website quảng bá đào tạo kép, chuyển tiếp nhưng CĐ Công nghệ cao Hà Nội nói đó không phải liên kết](https://giaoduc.net.vn/website-quang-ba-dao-tao-kep-chuyen-tiep-nhung-cd-cong-nghe-cao-ha-noi-noi-do-khong-phai-lien-ket-post261914.gd) | 07/2026 | Không (chỉ đối chiếu) |
| S22 | [Tuyensinh247 – trang "Cao đẳng Công nghệ Hà Nội (CNH)"](https://diemthi.tuyensinh247.com/de-an-tuyen-sinh/cao-dang-cong-nghe-ha-noi-CNH.html) | 2025 | Không (chỉ đối chiếu) |

## Cần bổ sung trước giai đoạn thử nghiệm

- Bảng học phí từng ngành, lệ phí xét tuyển, các khoản thu đầu khóa.
- Chỉ tiêu từng ngành hệ Cao đẳng và Trung cấp.
- Thông tin ký túc xá: giá, loại phòng, thủ tục đăng ký.
- Giờ làm việc của phòng tuyển sinh. Hệ thống đang dùng khung giờ MẪU 08:00–11:30 và 13:30–16:30.
- Danh sách 09 ngành tuyển cho bộ đội xuất ngũ.
- Văn bản thông báo tuyển sinh 2027–2028: tải lên Admin › Kho tri thức, rồi đổi CURRENT_ADMISSION_YEAR.
