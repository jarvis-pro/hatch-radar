import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { hasPermission, type PermissionKey } from '@hatch-radar/shared';
import { AccountService } from './account.service';
import type { AuthedUser } from './auth-user.decorator';
import { CSRF_HEADER, readSessionCookie } from './cookies';

/**
 * 会话鉴权共享原语：CSRF（写方法）→ httpOnly cookie → 会话解析（含滑动续期）→ 能力闸。
 *
 * {@link SessionAuthGuard}（纯会话）与双通道守卫（DeviceOrSessionGuard）的会话分支共用本实现——
 * 安全代码里的重复最危险（一处修了 CSRF / 会话逻辑、另一处忘改即裂开），故收口于此。
 */
@Injectable()
export class SessionAuthenticator {
  constructor(private readonly account: AccountService) {}

  /**
   * 校验会话请求并返回登录用户；任一环节失败抛对应 HttpException
   * （CSRF / 权限不足 → 403，未登录 / 会话失效 → 401）。
   * @param requiredPerm 路由所需能力（由各守卫读各自元数据键后传入）；省略＝仅校验登录态
   * @param noTokenMessage 无 token 时的 401 文案（双通道守卫用以提示「或缺少设备签名」）
   */
  async authenticate(
    req: Request,
    requiredPerm?: PermissionKey,
    noTokenMessage = '未登录',
  ): Promise<AuthedUser> {
    const method = (req.method ?? 'GET').toUpperCase();
    const isWrite = method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';
    if (isWrite && req.headers[CSRF_HEADER] !== '1') {
      throw new ForbiddenException('CSRF 校验失败：缺少 X-Radar-Csrf 头');
    }

    const token = readSessionCookie(req);
    if (!token) {
      throw new UnauthorizedException(noTokenMessage);
    }
    const user = await this.account.resolveSession(token);
    if (!user) {
      throw new UnauthorizedException('会话无效或已过期');
    }

    if (
      requiredPerm &&
      !hasPermission(user.role, user.permissions, requiredPerm, user.status === 'active')
    ) {
      throw new ForbiddenException('无权访问');
    }
    return user;
  }
}
