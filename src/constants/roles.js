'use strict';
/**
 * Vai trò cán bộ.
 *  - SUPER_ADMIN       Quản trị hệ thống: TOÀN QUYỀN (có mặt trong mọi nhóm quyền), cài đặt AI, tài khoản.
 *  - LEADER            Lãnh đạo: xem, duyệt FAQ, công bố tài liệu.
 *  - ADMISSION_OFFICE  Phòng Tuyển sinh: thông tin tuyển sinh của mọi ngành (hệ, chỉ tiêu CS1/2/3, thời gian học,
 *                      học phí, phương thức), hồ sơ, đợt nhận hồ sơ, hướng dẫn, liên hệ, hỏi đáp.
 *  - FACULTY           Cán bộ Khoa: như Phòng Tuyển sinh nhưng chỉ trong KHOA MÌNH (staff.faculty): sửa/thêm ngành
 *                      và bảng thông tin tuyển sinh theo hệ; thêm/sửa mục hồ sơ, đợt, liên hệ gắn với ngành của khoa.
 *  - ADVISOR           Cán bộ tư vấn: trả lời câu hỏi chuyển cán bộ, lịch hẹn, soạn FAQ.
 */
const ROLES = Object.freeze({
  SUPER_ADMIN: 'SUPER_ADMIN', LEADER: 'LEADER', ADMISSION_OFFICE: 'ADMISSION_OFFICE', FACULTY: 'FACULTY', ADVISOR: 'ADVISOR',
});

const ROLE_LABEL_VI = Object.freeze({
  SUPER_ADMIN: 'Quản trị hệ thống', LEADER: 'Lãnh đạo', ADMISSION_OFFICE: 'Phòng Tuyển sinh', FACULTY: 'Cán bộ Khoa', ADVISOR: 'Cán bộ tư vấn',
});

/** Vai trò -> nhóm quyền (route chỉ khai báo nhóm, thêm vai trò chỉ sửa ở đây + CHECK trong schema). */
const PERMISSION_GROUPS = Object.freeze({
  KB_VIEW: ['SUPER_ADMIN', 'LEADER', 'ADMISSION_OFFICE', 'FACULTY', 'ADVISOR'], // xem kho tri thức
  KB_MANAGE: ['SUPER_ADMIN', 'ADMISSION_OFFICE', 'ADVISOR'],                     // upload tài liệu
  KB_PUBLISH: ['SUPER_ADMIN', 'LEADER', 'ADMISSION_OFFICE'],                     // công bố tài liệu vào kho trả lời
  FAQ_EDIT: ['SUPER_ADMIN', 'LEADER', 'ADMISSION_OFFICE', 'FACULTY', 'ADVISOR'], // soạn FAQ (DRAFT)
  FAQ_APPROVE: ['SUPER_ADMIN', 'LEADER', 'ADMISSION_OFFICE'],
  MAJOR_MANAGE: ['SUPER_ADMIN', 'ADMISSION_OFFICE', 'FACULTY', 'ADVISOR'],       // FACULTY bị giới hạn trong khoa mình
  ADMISSION_INFO: ['SUPER_ADMIN', 'ADMISSION_OFFICE', 'FACULTY', 'ADVISOR'],     // hồ sơ, đợt, hướng dẫn, liên hệ, giải thích hệ (FACULTY: mục của ngành thuộc khoa mình)
  CONTACT_CONFIG: ['SUPER_ADMIN', 'ADMISSION_OFFICE'],                           // hotline, email, địa chỉ nộp hồ sơ…
  HANDOFF: ['SUPER_ADMIN', 'ADMISSION_OFFICE', 'ADVISOR'],
  ANALYTICS: ['SUPER_ADMIN', 'LEADER', 'ADMISSION_OFFICE', 'ADVISOR'],
  APPOINTMENT_MANAGE: ['SUPER_ADMIN', 'LEADER', 'ADMISSION_OFFICE', 'ADVISOR'],
  CONFIG: ['SUPER_ADMIN'],
  STAFF_MANAGEMENT: ['SUPER_ADMIN'],
});

// Quản trị hệ thống luôn có mọi quyền, kể cả nhóm quyền thêm sau này.
for (const roles of Object.values(PERMISSION_GROUPS)) if (!roles.includes('SUPER_ADMIN')) throw new Error('SUPER_ADMIN phải có mọi nhóm quyền');

/** Danh sách nhóm quyền của một vai trò (trả cho giao diện quản trị để ẩn/hiện chức năng). */
const permissionsOf = (role) => Object.keys(PERMISSION_GROUPS).filter((g) => PERMISSION_GROUPS[g].includes(role));

/** Vai trò bị giới hạn theo khoa: chỉ thao tác trên ngành có majors.faculty = staff.faculty. */
const FACULTY_SCOPED_ROLES = Object.freeze(['FACULTY']);

module.exports = { ROLES, ROLE_LABEL_VI, PERMISSION_GROUPS, permissionsOf, FACULTY_SCOPED_ROLES };
