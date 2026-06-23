import { type ExecutionContext, SetMetadata, createParamDecorator } from '@nestjs/common';
import type { PermissionKey } from '@hatch-radar/shared';
import type { AuthedUser } from '@/types/auth-context';

/** 路由所需能力 key 的元数据键。 */
export const REQUIRE_PERMISSION = 'require_permission';

/** 标注某路由所需的能力（SessionAuthGuard 据此做能力闸，super_admin 隐式全通）。 */
export const RequirePermission = (key: PermissionKey) => SetMetadata(REQUIRE_PERMISSION, key);

/**
 * 取当前登录用户（SessionAuthGuard 校验通过后附到 req.user）。
 *
 * 仅用于挂了 SessionAuthGuard 的路由——守卫放行即保证 req.user 已就位，故类型非空。
 * 漏挂守卫会让运行期为 undefined 而类型仍断言非空，属用法错误（须与守卫成对出现）。
 */
export const AuthUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthedUser =>
    ctx.switchToHttp().getRequest<{ user: AuthedUser }>().user,
);
