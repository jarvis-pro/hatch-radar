import { saveClassMetadata, savePropertyMetadata } from '@midwayjs/core';
import type { PermissionKey } from '@hatch-radar/shared';

/** 设备用户上下文类型（领域类型,定义在 @hatch-radar/core；此处转出供控制器沿用原导入路径）。 */
export type { DeviceUserContext } from '@hatch-radar/core';

/** 路由所需的设备能力 key 的元数据键。 */
export const DEVICE_PERMISSION = 'device_permission';

/**
 * 标注某路由所需的能力（设备通道与会话通道共用）。可用作类/方法装饰器，守卫按「方法级覆盖类级」读取。
 */
export function RequireDevicePermission(key: PermissionKey): ClassDecorator & MethodDecorator {
  return ((target: object, propertyKey?: string | symbol): void => {
    if (propertyKey !== undefined) {
      savePropertyMetadata(DEVICE_PERMISSION, key, target, propertyKey);
    } else {
      saveClassMetadata(DEVICE_PERMISSION, key, target);
    }
  }) as ClassDecorator & MethodDecorator;
}
