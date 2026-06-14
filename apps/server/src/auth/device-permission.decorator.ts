import { type ExecutionContext, SetMetadata, createParamDecorator } from '@nestjs/common';
import type { PermissionKey, UserRole } from '@hatch-radar/shared';

/** 路由所需的设备能力 key 的元数据键。 */
export const DEVICE_PERMISSION = 'device_permission';

/** 标注某路由在「设备通道」下所需的能力（service 令牌通道豁免，由 web 自行鉴权）。 */
export const RequireDevicePermission = (key: PermissionKey) => SetMetadata(DEVICE_PERMISSION, key);

/** 通过设备验签解析出的用户上下文（由 MachineOrDeviceGuard 附加到 req.deviceUser）。 */
export interface DeviceUserContext {
  id: string;
  role: UserRole;
  email: string;
  credentialId: string;
}

/** 取当前设备用户；service 令牌通道无设备用户，返回 undefined。 */
export const DeviceUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): DeviceUserContext | undefined =>
    ctx.switchToHttp().getRequest<{ deviceUser?: DeviceUserContext }>().deviceUser,
);
