import type { UserRole } from '@hatch-radar/shared';

/** 通过设备验签解析出的用户上下文。框架无关的领域类型（api 侧 @DeviceUser 装饰器附加）。 */
export interface DeviceUserContext {
  id: string;
  role: UserRole;
  email: string;
  credentialId: string;
}
