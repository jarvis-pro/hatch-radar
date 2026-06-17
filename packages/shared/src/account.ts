/**
 * 账户 / 会话 / 管理的「跨端契约类型」——server 产出、web SPA 消费的 JSON 形状单一来源。
 *
 * 纯类型、零运行时依赖（与本包其它文件一致）。时间戳一律 Unix 秒（number），
 * 与全库 BigInt 时间戳同口径但已在 server 出口转成 number。
 */
import type { PermissionKey, UserRole } from './permissions';

/**
 * 当前登录用户（`GET /api/auth/session` 返回）。
 * web 用于路由守卫与按能力目录做导航显隐；不含 sessionId 等 server 内部字段。
 */
export interface CurrentUser {
  id: string;
  email: string;
  name: string;
  /** 头像 seed（DiceBear adventurer-neutral）；null=用姓名首字母回退。 */
  avatar: string | null;
  role: UserRole;
  status: 'active' | 'disabled';
  mustChangePassword: boolean;
  permissions: PermissionKey[];
}

/** 个人中心的会话列表行（`GET /api/auth/sessions`）。current=当前这条。 */
export interface SessionInfo {
  id: string;
  current: boolean;
  userAgent: string | null;
  ip: string | null;
  lastSeenAt: number;
  createdAt: number;
}

/** 账户管理列表的一行（含已授予权限与设备数）。 */
export interface AdminUserRow {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  status: 'active' | 'disabled';
  mustChangePassword: boolean;
  permissions: PermissionKey[];
  deviceCount: number;
  lastLoginAt: number | null;
  createdAt: number;
}

/** 设备凭据（账户管理设备面板用）。 */
export interface DeviceRow {
  id: string;
  userId: string;
  deviceName: string;
  status: 'active' | 'revoked';
  ttlDays: number;
  expiresAt: number;
  lastSeenAt: number | null;
  createdAt: number;
}

/** 待激活的激活码（pending、未过期）。 */
export interface EnrollmentRow {
  id: string;
  userId: string;
  deviceName: string;
  ttlDays: number;
  expiresAt: number;
  createdAt: number;
}

/** 审计列表的一行（actor_id 已解析为邮箱）。 */
export interface AuditRow {
  id: number;
  actorEmail: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  ip: string | null;
  createdAt: number;
}
