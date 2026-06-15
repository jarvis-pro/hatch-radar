import { type ExecutionContext, SetMetadata, createParamDecorator } from '@nestjs/common';
import type { PermissionKey } from '@hatch-radar/shared';
import type { AuthedUser } from '@hatch-radar/core';

/** 登录用户上下文类型（领域类型,定义在 @hatch-radar/core；此处转出供控制器/守卫沿用原导入路径）。 */
export type { AuthedUser };

/** 路由所需能力 key 的元数据键。 */
export const REQUIRE_PERMISSION = 'require_permission';

/** 标注某路由所需的能力（SessionAuthGuard 据此做能力闸，super_admin 隐式全通）。 */
export const RequirePermission = (key: PermissionKey) => SetMetadata(REQUIRE_PERMISSION, key);

/** 取当前登录用户（由 SessionAuthGuard 附加到 req.user）。 */
export const AuthUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthedUser =>
    ctx.switchToHttp().getRequest<{ user: AuthedUser }>().user,
);
