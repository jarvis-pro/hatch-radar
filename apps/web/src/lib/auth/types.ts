import type { PermissionKey, UserRole } from '@hatch-radar/shared';

/** 服务端解析出的当前登录用户（含已加载权限）。 */
export interface CurrentUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  status: 'active' | 'disabled';
  mustChangePassword: boolean;
  permissions: PermissionKey[];
  /** 当前会话 id（「登出其他会话」时保留自身用）。 */
  sessionId: string;
}

/** 传给客户端组件（导航 / 用户菜单）的精简用户信息——不含会话 id 等敏感字段。 */
export interface PublicUser {
  name: string;
  email: string;
  role: UserRole;
  permissions: PermissionKey[];
}

/** 登录表单 action 状态。 */
export interface LoginState {
  error?: string;
}

/** 通用表单 action 状态（改密等）。 */
export interface FormState {
  error?: string;
  ok?: boolean;
}
