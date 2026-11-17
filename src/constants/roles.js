'use strict';
/**
 * Vai trò cán bộ.
 *  - SUPER_ADMIN       Quản trị hệ thống: toàn quyền, cài đặt AI, tài khoản.
 *  - LEADER            Lãnh đạo: xem, duyệt FAQ, công bố tài liệu.
 *  - ADMISSION_OFFICE  Phòng Tuyển sinh: quản lý hồ sơ, đợt nhận hồ sơ, ngành của mọi khoa, hỏi đáp, liên hệ.
 *  - FACULTY           Cán bộ Khoa: chỉ sửa/thêm ngành của KHOA MÌNH (staff.faculty), soạn hỏi đáp chờ duyệt.
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
  ADMISSION_INFO: ['SUPER_ADMIN', 'ADMISSION_OFFICE', 'ADVISOR'],                // hồ sơ, đợt nhận hồ sơ, hướng dẫn, liên hệ, giải thích hệ
  CONTACT_CONFIG: ['SUPER_ADMIN', 'ADMISSION_OFFICE'],                           // hotline, email, địa chỉ nộp hồ sơ…
  HANDOFF: ['SUPER_ADMIN', 'ADMISSION_OFFICE', 'ADVISOR'],
  ANALYTICS: ['SUPER_ADMIN', 'LEADER', 'ADMISSION_OFFICE', 'ADVISOR'],
  APPOINTMENT_MANAGE: ['SUPER_ADMIN', 'LEADER', 'ADMISSION_OFFICE', 'ADVISOR'],
  CONFIG: ['SUPER_ADMIN'],
  STAFF_MANAGEMENT: ['SUPER_ADMIN'],
});

/** Danh sách nhóm quyền của một vai trò (trả cho giao diện quản trị để ẩn/hiện chức năng). */
const permissionsOf = (role) => Object.keys(PERMISSION_GROUPS).filter((g) => PERMISSION_GROUPS[g].includes(role));

/** Vai trò bị giới hạn theo khoa: chỉ thao tác trên ngành có majors.faculty = staff.faculty. */
const FACULTY_SCOPED_ROLES = Object.freeze(['FACULTY']);

module.exports = { ROLES, ROLE_LABEL_VI, PERMISSION_GROUPS, permissionsOf, FACULTY_SCOPED_ROLES };
