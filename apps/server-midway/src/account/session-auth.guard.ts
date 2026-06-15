import {
  getClassMetadata,
  getPropertyMetadata,
  Guard,
  httpError,
  type IGuard,
  Inject,
} from '@midwayjs/core';
import type { Context } from '@midwayjs/koa';
import { type AccountService } from '@hatch-radar/core';
import { hasPermission, type PermissionKey } from '@hatch-radar/shared';
import { TOK } from '@/common/tokens';
import { type AuthedUser, REQUIRE_PERMISSION } from './auth-user.decorator';
import { CSRF_HEADER, readSessionCookie } from './cookies';

/**
 * 会话守卫（所有 web 面向端点）：唯一鉴权权威 + fail-closed，无局域网放行。
 * 与 NestJS 版 SessionAuthGuard 逐条等价：
 *
 * 1. 写方法（非 GET/HEAD/OPTIONS）要求自定义头 {@link CSRF_HEADER}=1（CSRF 兜底）；
 * 2. 读 httpOnly `radar_session` cookie → AccountService 校验（含滑动续期）→ 附 ctx.user；
 * 3. 若路由声明 @RequirePermission（方法级覆盖类级），按能力目录做闸（super_admin 隐式全通，停用即否）。
 * 缺失 / 无效 → 401；权限不足 → 403。
 */
@Guard()
export class SessionAuthGuard implements IGuard<Context> {
  @Inject(TOK.account)
  account!: AccountService;

  async canActivate(
    ctx: Context,
    supplierClz: new (...args: any[]) => any,
    methodName: string,
  ): Promise<boolean> {
    const method = (ctx.method ?? 'GET').toUpperCase();
    const isWrite = method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';
    if (isWrite && ctx.headers[CSRF_HEADER] !== '1') {
      throw new httpError.ForbiddenError('CSRF 校验失败：缺少 X-Radar-Csrf 头');
    }

    const token = readSessionCookie(ctx);
    if (!token) throw new httpError.UnauthorizedError('未登录');
    const user = await this.account.resolveSession(token);
    if (!user) throw new httpError.UnauthorizedError('会话无效或已过期');
    (ctx as Context & { user?: AuthedUser }).user = user;

    const requiredPerm =
      getPropertyMetadata<PermissionKey | undefined>(REQUIRE_PERMISSION, supplierClz, methodName) ??
      getClassMetadata<PermissionKey | undefined>(REQUIRE_PERMISSION, supplierClz);
    if (
      requiredPerm &&
      !hasPermission(user.role, user.permissions, requiredPerm, user.status === 'active')
    ) {
      throw new httpError.ForbiddenError('无权访问');
    }
    return true;
  }
}
