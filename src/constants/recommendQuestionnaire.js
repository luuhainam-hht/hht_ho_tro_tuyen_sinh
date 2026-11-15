'use strict';
/**
 * Bảng hỏi gợi ý ngành (M4): 18 câu Holland RIASEC (Likert 1–5) + 7 môn tự đánh giá + 4 mong muốn.
 * Nội dung câu hỏi viết cho học sinh lớp 9/12, tránh thuật ngữ tâm lý học.
 */
const RIASEC = Object.freeze({
  R: 'Kỹ thuật – thực hành', I: 'Nghiên cứu – phân tích', A: 'Nghệ thuật – sáng tạo',
  S: 'Xã hội – hỗ trợ', E: 'Quản lý – kinh doanh', C: 'Nghiệp vụ – quy trình',
});

const RIASEC_ITEMS = Object.freeze([
  { id: 'r1', type: 'R', text: 'Em thích tháo lắp, sửa chữa đồ dùng, máy móc, xe cộ.' },
  { id: 'r2', type: 'R', text: 'Em thích làm việc bằng tay với dụng cụ, máy móc hơn là ngồi viết giấy tờ.' },
  { id: 'r3', type: 'R', text: 'Em thích hoạt động ngoài trời, chăm sóc cây trồng hoặc vật nuôi.' },
  { id: 'i1', type: 'I', text: 'Em hay tò mò tìm hiểu vì sao một thiết bị hoặc phần mềm hoạt động được.' },
  { id: 'i2', type: 'I', text: 'Em thích giải bài toán, câu đố cần suy luận logic.' },
  { id: 'i3', type: 'I', text: 'Em thích khám phá công nghệ mới: máy tính, lập trình, điện tử.' },
  { id: 'a1', type: 'A', text: 'Em thích vẽ, thiết kế, phối màu, trang trí.' },
  { id: 'a2', type: 'A', text: 'Em có gu thẩm mỹ, thích làm đẹp cho đồ vật hoặc cho mọi người.' },
  { id: 'a3', type: 'A', text: 'Em thích sáng tạo nội dung: hình ảnh, video, bài đăng mạng xã hội.' },
  { id: 's1', type: 'S', text: 'Em thích giúp đỡ, chăm sóc người khác.' },
  { id: 's2', type: 'S', text: 'Em thích trò chuyện, giải thích để người khác hiểu.' },
  { id: 's3', type: 'S', text: 'Em thích đón tiếp, phục vụ, làm cho khách hàng hài lòng.' },
  { id: 'e1', type: 'E', text: 'Em thích thuyết phục người khác, bán hàng hoặc kinh doanh nhỏ.' },
  { id: 'e2', type: 'E', text: 'Em hay được giao làm lớp trưởng, trưởng nhóm, tổ chức sự kiện.' },
  { id: 'e3', type: 'E', text: 'Em muốn sau này tự mở cửa hàng, xưởng hoặc doanh nghiệp.' },
  { id: 'c1', type: 'C', text: 'Em thích làm việc theo quy trình rõ ràng, ngăn nắp.' },
  { id: 'c2', type: 'C', text: 'Em thích làm việc với số liệu, bảng tính, sổ sách.' },
  { id: 'c3', type: 'C', text: 'Em cẩn thận, tỉ mỉ, ít khi sai sót.' },
]);

const SUBJECTS = Object.freeze({
  TOAN: 'Toán', VAT_LY: 'Vật lý / Công nghệ', HOA_SINH: 'Hóa – Sinh', NGU_VAN: 'Ngữ văn',
  NGOAI_NGU: 'Ngoại ngữ', TIN_HOC: 'Tin học', MY_THUAT: 'Mỹ thuật',
});

const EDUCATION = Object.freeze({
  THCS: { label: 'Đã/sắp tốt nghiệp THCS (lớp 9)', allowedLevels: ['HE_9_PLUS', 'TRUNG_CAP', 'SO_CAP'] },
  THPT: { label: 'Đã/sắp tốt nghiệp THPT (lớp 12)', allowedLevels: ['CAO_DANG', 'TRUNG_CAP', 'SO_CAP'] },
  HIGHER: { label: 'Đã có bằng Trung cấp, Cao đẳng hoặc Đại học', allowedLevels: ['CAO_DANG', 'SO_CAP'] },
});

const WORK_STYLES = Object.freeze({
  WORKSHOP: 'Xưởng, nhà máy, thiết bị',
  OFFICE: 'Văn phòng, máy tính',
  PEOPLE: 'Gặp gỡ, phục vụ con người',
  OUTDOOR: 'Ngoài trời, trang trại',
  CREATIVE: 'Studio, sáng tạo',
});

module.exports = { RIASEC, RIASEC_ITEMS, SUBJECTS, EDUCATION, WORK_STYLES };
