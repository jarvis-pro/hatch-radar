import { type ExecutionContext, SetMetadata, createParamDecorator } from '@nestjs/common';
import type { CurrentUser, PermissionKey } from '@hatch-radar/shared';

/** 会话解析出的登录用户上下文（CurrentUser + 内部 sessionId，用于「登出其他会话」/ 标记当前会话）。 */
export interface AuthedUser extends CurrentUser {
  /** 当前会话 id（SessionAuthGuard 解析得出）。 */
  sessionId: string;
}

/** 路由所需能力 key 的元数据键。 */
export const REQUIRE_PERMISSION = 'require_permission';

/** 标注某路由所需的能力（SessionAuthGuard 据此做能力闸，super_admin 隐式全通）。 */
export const RequirePermission = (key: PermissionKey) => SetMetadata(REQUIRE_PERMISSION, key);

/** 取当前登录用户（由 SessionAuthGuard 附加到 req.user）。 */
export const AuthUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthedUser =>
    ctx.switchToHttp().getRequest<{ user: AuthedUser }>().user,
);
