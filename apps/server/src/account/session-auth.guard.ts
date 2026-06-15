import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { hasPermission, type PermissionKey } from '@hatch-radar/shared';
import { AccountService } from '@hatch-radar/core';
import { AuthedUser, REQUIRE_PERMISSION } from './auth-user.decorator';
import { CSRF_HEADER, readSessionCookie } from './cookies';

/**
 * 会话守卫（所有 web 面向端点）：唯一鉴权权威 + fail-closed，无局域网放行。
 *
 * 1. 写方法（非 GET/HEAD/OPTIONS）要求自定义头 {@link CSRF_HEADER}=1（同源 SPA 恒带；CSRF 兜底）；
 * 2. 读 httpOnly `radar_session` cookie → AccountService 校验（含滑动续期）→ 附 req.user；
 * 3. 若路由声明 @RequirePermission，按能力目录做闸（super_admin 隐式全通，停用即否）。
 * 缺失 / 无效 → 401；权限不足 → 403。
 */
@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(
    private readonly account: AccountService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & { user?: AuthedUser }>();

    const method = (req.method ?? 'GET').toUpperCase();
    const isWrite = method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';
    if (isWrite && req.headers[CSRF_HEADER] !== '1') {
      throw new ForbiddenException('CSRF 校验失败：缺少 X-Radar-Csrf 头');
    }

    const token = readSessionCookie(req);
    if (!token) throw new UnauthorizedException('未登录');
    const user = await this.account.resolveSession(token);
    if (!user) throw new UnauthorizedException('会话无效或已过期');
    req.user = user;

    const requiredPerm = this.reflector.getAllAndOverride<PermissionKey | undefined>(
      REQUIRE_PERMISSION,
      [context.getHandler(), context.getClass()],
    );
    if (
      requiredPerm &&
      !hasPermission(user.role, user.permissions, requiredPerm, user.status === 'active')
    ) {
      throw new ForbiddenException('无权访问');
    }
    return true;
  }
}
