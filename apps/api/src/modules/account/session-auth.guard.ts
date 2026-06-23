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
import { AccountService } from './account.service';
import type { AuthedUser } from './auth-context';
import { REQUIRE_PERMISSION } from './auth-user.decorator';
import { CSRF_HEADER, readSessionCookie } from './cookies';

/**
 * 会话守卫（所有 web 面向端点）：唯一鉴权权威 + fail-closed，无局域网放行。
 *
 * 一处收口 CSRF（写方法）→ httpOnly cookie → 会话解析（含滑动续期）→ 能力闸，
 * 放行前把解析出的用户附到 req.user 供 @AuthUser 取用。安全逻辑收于此处不再外抽——
 * 移动端设备通道退役后已无第二个调用方，多一层间接只会让 CSRF / 会话校验更难一眼看全。
 */
@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(
    private readonly account: AccountService,
    private readonly reflector: Reflector,
  ) {}

  /**
   * 校验会话并放行；任一环节失败抛对应 HttpException
   * （CSRF / 权限不足 → 403，未登录 / 会话失效 → 401）。放行后 req.user 必非空。
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & { user?: AuthedUser }>();

    const method = (req.method ?? 'GET').toUpperCase();
    const isWrite = method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';
    if (isWrite && req.headers[CSRF_HEADER] !== '1') {
      throw new ForbiddenException('CSRF 校验失败：缺少 X-Radar-Csrf 头');
    }

    const token = readSessionCookie(req);
    if (!token) {
      throw new UnauthorizedException('未登录');
    }

    const user = await this.account.resolveSession(token);
    if (!user) {
      throw new UnauthorizedException('会话无效或已过期');
    }

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

    req.user = user;

    return true;
  }
}
