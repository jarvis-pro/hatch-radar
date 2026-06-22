import { type ExecutionContext, SetMetadata, createParamDecorator } from '@nestjs/common';
import type { PermissionKey } from '@hatch-radar/shared';
import type { DeviceUserContext } from './device-context';

/** 设备用户上下文类型（定义在同目录 ./device-context；此处转出供控制器沿用原导入路径）。 */
export type { DeviceUserContext };

/** 路由所需的设备能力 key 的元数据键。 */
export const DEVICE_PERMISSION = 'device_permission';

/** 标注某路由所需的能力（设备通道与会话通道共用：两条都按此 key 校验）。 */
export const RequireDevicePermission = (key: PermissionKey) => SetMetadata(DEVICE_PERMISSION, key);

/** 取当前设备用户；service 令牌通道无设备用户，返回 undefined。 */
export const DeviceUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): DeviceUserContext | undefined =>
    ctx.switchToHttp().getRequest<{ deviceUser?: DeviceUserContext }>().deviceUser,
);
