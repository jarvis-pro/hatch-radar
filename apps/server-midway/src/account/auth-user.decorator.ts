import { saveClassMetadata, savePropertyMetadata } from '@midwayjs/core';
import type { PermissionKey } from '@hatch-radar/shared';

/** 登录用户上下文类型（领域类型,定义在 @hatch-radar/core；此处转出供控制器沿用原导入路径）。 */
export type { AuthedUser } from '@hatch-radar/core';

/** 路由所需能力 key 的元数据键。 */
export const REQUIRE_PERMISSION = 'require_permission';

/**
 * 标注某路由所需的能力（SessionAuthGuard 据此做能力闸，super_admin 隐式全通）。
 *
 * 同时可用作「类装饰器」与「方法装饰器」（对应 NestJS 的 SetMetadata）：
 * - 方法级 → savePropertyMetadata；类级 → saveClassMetadata。
 * 守卫按「方法级覆盖类级」读取（对应 reflector.getAllAndOverride([handler, class])）。
 */
export function RequirePermission(key: PermissionKey): ClassDecorator & MethodDecorator {
  return ((target: object, propertyKey?: string | symbol): void => {
    if (propertyKey !== undefined) {
      savePropertyMetadata(REQUIRE_PERMISSION, key, target, propertyKey);
    } else {
      saveClassMetadata(REQUIRE_PERMISSION, key, target);
    }
  }) as ClassDecorator & MethodDecorator;
}
