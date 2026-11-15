'use strict';
/** Danh mục cố định dùng chung frontend/backend (trả qua /api/meta). */
const LEVELS = Object.freeze({
  HE_9_PLUS: 'Hệ 9+ (THPT – Cao đẳng)',
  TRUNG_CAP: 'Trung cấp',
  CAO_DANG: 'Cao đẳng / CĐ liên thông',
  SO_CAP: 'Sơ cấp – ngắn hạn',
});

const AUDIENCES = Object.freeze({
  CHINH_QUY: 'Cao đẳng, Trung cấp chính quy',
  HE_9_PLUS: 'Hệ 9+ (tốt nghiệp THCS)',
  BO_DOI: 'Bộ đội, Công an xuất ngũ',
});

const TOPICS = Object.freeze({
  GIOI_THIEU: 'Giới thiệu trường',
  TUYEN_SINH: 'Tuyển sinh chung',
  NGANH: 'Ngành nghề',
  HOC_PHI: 'Học phí & hỗ trợ',
  HO_SO: 'Hồ sơ & thủ tục',
  LICH: 'Thời gian tuyển sinh',
  HE_9_PLUS: 'Hệ 9+',
  LIEN_THONG: 'Liên thông',
  DOI_TUONG_DAC_BIET: 'Đối tượng đặc biệt',
  DAT_HANG_DN: 'Hệ đặt hàng doanh nghiệp',
  NGAN_HAN_KHAC: 'Ngắn hạn, du học, khác',
  KTX: 'Ký túc xá',
  VIEC_LAM: 'Việc làm',
  LIEN_HE: 'Liên hệ',
  KHAC: 'Khác',
});

const COPY_TYPES = Object.freeze({
  ORIGINAL: 'Bản chính', COPY: 'Bản sao', CERTIFIED_COPY: 'Bản sao công chứng',
  ORIGINAL_AND_COPY: 'Bản chính + bản sao công chứng', FORM: 'Theo mẫu', PHOTO: 'Ảnh',
});

module.exports = { LEVELS, AUDIENCES, TOPICS, COPY_TYPES };
