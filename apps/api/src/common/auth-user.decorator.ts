import { type ExecutionContext, SetMetadata, createParamDecorator } from '@nestjs/common';
import type { PermissionKey } from '@hatch-radar/shared';
import type { AuthedUser } from '@/types/auth-context';

/** 路由所需能力 key 的元数据键。 */
export const REQUIRE_PERMISSION = 'require_permission';

/** 标注某路由所需的能力（SessionAuthGuard 据此做能力闸，super_admin 隐式全通）。 */
export const RequirePermission = (key: PermissionKey) => SetMetadata(REQUIRE_PERMISSION, key);

/** `@Public()` 标记的元数据键：全局会话守卫见到即短路放行（不校验会话）。 */
export const IS_PUBLIC = 'is_public';

/**
 * 标注某路由为公开端点，豁免全局会话守卫（登录 / 健康检查等无会话前置的入口）。
 *
 * 守卫默认全局挂载（fail-closed）：未标 @Public 的路由一律要求有效会话，故公开面是显式的
 * 少数派、须在此点名；新增端点漏标只会被锁死而非意外敞开。
 */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/**
 * 取当前登录用户（全局会话守卫校验通过后附到 req.user）。
 *
 * 守卫已全局挂载，任何非 @Public 路由放行后 req.user 必就位，故类型非空；
 * 勿在 @Public 路由上用本装饰器（那里无会话、运行期为 undefined 而类型仍断言非空）。
 */
export const AuthUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthedUser =>
    ctx.switchToHttp().getRequest<{ user: AuthedUser }>().user,
);
