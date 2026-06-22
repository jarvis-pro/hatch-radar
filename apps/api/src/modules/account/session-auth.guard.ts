import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { PermissionKey } from '@hatch-radar/shared';
import { type AuthedUser, REQUIRE_PERMISSION } from './auth-user.decorator';
import { SessionAuthenticator } from './session-authenticator';

/**
 * 会话守卫（所有 web 面向端点）：唯一鉴权权威 + fail-closed，无局域网放行。
 *
 * 会话校验（CSRF / cookie / 解析 / 能力闸）下沉到 {@link SessionAuthenticator}（与双通道守卫共用）；
 * 本守卫只读 @RequirePermission 元数据并把解析出的用户附到 req.user。
 */
@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(
    private readonly authenticator: SessionAuthenticator,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & { user?: AuthedUser }>();
    const requiredPerm = this.reflector.getAllAndOverride<PermissionKey | undefined>(
      REQUIRE_PERMISSION,
      [context.getHandler(), context.getClass()],
    );
    req.user = await this.authenticator.authenticate(req, requiredPerm);
    return true;
  }
}
