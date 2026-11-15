'use strict';
const ROLES = Object.freeze({ SUPER_ADMIN: 'SUPER_ADMIN', LEADER: 'LEADER', ADVISOR: 'ADVISOR' });

const ROLE_LABEL_VI = Object.freeze({ SUPER_ADMIN: 'Quản trị hệ thống', LEADER: 'Lãnh đạo', ADVISOR: 'Cán bộ tư vấn' });

/** Vai trò -> nhóm quyền (route chỉ khai báo nhóm, thêm vai trò chỉ sửa ở đây + CHECK trong schema). */
const PERMISSION_GROUPS = Object.freeze({
  KB_VIEW: ['SUPER_ADMIN', 'LEADER', 'ADVISOR'],          // xem kho tri thức (Lãnh đạo cần xem để công bố)
  KB_MANAGE: ['SUPER_ADMIN', 'ADVISOR'],                 // upload tài liệu, sửa ngành, mục cẩm nang
  KB_PUBLISH: ['SUPER_ADMIN', 'LEADER'],                 // công bố tài liệu vào kho trả lời
  FAQ_EDIT: ['SUPER_ADMIN', 'LEADER', 'ADVISOR'],        // soạn FAQ (DRAFT)
  FAQ_APPROVE: ['SUPER_ADMIN', 'LEADER'],
  HANDOFF: ['SUPER_ADMIN', 'ADVISOR'],
  ANALYTICS: ['SUPER_ADMIN', 'LEADER', 'ADVISOR'],
  APPOINTMENT_MANAGE: ['SUPER_ADMIN', 'LEADER', 'ADVISOR'],
  CONFIG: ['SUPER_ADMIN'],
  STAFF_MANAGEMENT: ['SUPER_ADMIN'],
});

module.exports = { ROLES, ROLE_LABEL_VI, PERMISSION_GROUPS };
