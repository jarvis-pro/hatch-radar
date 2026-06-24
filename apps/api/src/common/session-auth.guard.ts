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
import { AccountService } from '@/modules/account/account.service';
import type { AuthedUser } from '@/types/auth-context';
import { IS_PUBLIC, REQUIRE_PERMISSION } from './auth-user.decorator';

/** 从 Authorization: Bearer <token> 头提取 token。 */
function readBearerToken(req: Request): string | undefined {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) {
    return undefined;
  }

  return auth.slice(7) || undefined;
}

/**
 * 会话守卫：唯一鉴权权威，经 APP_GUARD 全局挂载，默认 fail-closed。
 *
 * 全局生效——除显式 @Public（登录 / 健康检查）外，所有路由先过此守卫：
 * @Public 短路放行 → Bearer token → 会话解析（含滑动续期）→ 能力闸，
 * 放行前把解析出的用户附到 req.user 供 @AuthUser 取用。默认拒绝意味着新增端点漏标即被锁死、
 * 不会意外敞开。
 */
@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(
    // 账户领域服务：据 Bearer token 解析会话（含滑动续期）
    private readonly account: AccountService,
    // Nest 反射器：读路由的 @Public / @RequirePermission 元数据
    private readonly reflector: Reflector,
  ) {}

  /**
   * 校验会话并放行；任一环节失败抛对应 HttpException
   * （权限不足 → 403，未登录 / 会话失效 → 401）。
   *
   * - @Public 路由直接放行、不解析会话（req.user 不设置）。
   * - 其余路由放行后 req.user 必非空。
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & { user?: AuthedUser }>();

    // @Public 路由（登录 / 健康检查）豁免：先于会话校验短路放行。
    if (
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
        context.getHandler(),
        context.getClass(),
      ])
    ) {
      return true;
    }

    const token = readBearerToken(req);
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
