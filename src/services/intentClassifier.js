'use strict';
/**
 * Phân loại chủ đề/ngành bằng từ khóa (tất định, không tốn token). Dùng khi không có LLM,
 * và cho job CLASSIFY_MESSAGES hằng đêm để dashboard thống kê "top chủ đề, top ngành".
 */
const { normalizeVi, keywords } = require('../utils/textNormalize');

const TOPIC_RULES = [
  ['HOC_PHI', ['hoc phi', 'mien giam', 'hoc bong', 'ho tro', 'tien hoc', 'chi phi', 'mien phi', 'nghi quyet 57']],
  ['HO_SO', ['ho so', 'giay to', 'hoc ba', 'cccd', 'can cuoc', 'khai sinh', 'anh the', 'phieu dang ky', 'so yeu ly lich', 'nop ho so', 'cong chung']],
  ['LICH', ['khi nao', 'han nop', 'dot', 'thoi gian nhan', 'lich', 'nhap hoc', 'bao gio', 'thang']],
  ['HE_9_PLUS', ['9+', 'he 9', 'lop 9', 'thcs', 'lop 10', 'song bang']],
  ['LIEN_THONG', ['lien thong', 'bang trung cap', 'da co bang']],
  ['DOI_TUONG_DAC_BIET', ['bo doi', 'xuat ngu', 'cong an', 'the hoc nghe']],
  ['DAT_HANG_DN', ['dat hang', 'doanh nghiep', 'hanwha', 'ky su thuc hanh', 'huong luong']],
  ['KTX', ['ky tuc xa', 'ktx', 'cho o', 'phong o', 'noi tru', 'y te']],
  ['VIEC_LAM', ['viec lam', 'ra truong', 'luong', 'thu nhap', 'co hoi']],
  ['LIEN_HE', ['hotline', 'so dien thoai', 'lien he', 'email', 'fanpage', 'zalo', 'dia chi', 'o dau', 'co so']],
  ['NGAN_HAN_KHAC', ['ngan han', 'so cap', 'chung chi', 'du hoc', 'nhat ban', 'han quoc', 'bang lai', 'xuat khau']],
  ['GIOI_THIEU', ['cong lap', 'thanh lap', 'lich su', 'ma truong', 'danh hieu', 'khoa nao']],
  ['NGANH', ['nganh', 'nghe', 'chuyen nganh', 'hoc gi']],
  ['TUYEN_SINH', ['xet tuyen', 'thi tuyen', 'chi tieu', 'dieu kien', 'tuyen sinh', 'hoc ba']],
];

function createIntentClassifier({ getMajors = () => [] } = {}) {
  function classify(text) {
    const norm = ` ${normalizeVi(text).replace(/\b9 /g, '9+ ')} `;
    const topics = TOPIC_RULES.filter(([, keys]) => keys.some((k) => norm.includes(` ${k} `) || norm.includes(` ${k}`))).map(([t]) => t);
    // Nhận diện ngành: mọi từ khóa trong tên ngành (bỏ phần trong ngoặc) xuất hiện trong câu hỏi.
    const majorCodes = [];
    for (const m of getMajors()) {
      const names = m.name.split(/,|\(|\)/).map((s) => keywords(s)).filter((k) => k.length >= 2);
      if (names.some((k) => k.every((t) => norm.includes(` ${t} `)))) majorCodes.push(m.code);
    }
    if (majorCodes.length && !topics.includes('NGANH')) topics.push('NGANH');
    const finalTopics = topics.length ? topics.slice(0, 3) : ['KHAC'];
    return { intent: finalTopics[0], topics: finalTopics, majorCodes: majorCodes.slice(0, 3) };
  }
  return { classify };
}

module.exports = { createIntentClassifier, TOPIC_RULES };
