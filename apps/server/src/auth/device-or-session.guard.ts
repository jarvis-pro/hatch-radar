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
import { AccountService } from '@/account/account.service';
import { CSRF_HEADER, readSessionCookie } from '@/account/cookies';
import type { AuthedUser } from '@/account/auth-user.decorator';
import { DeviceAuthService } from './device-auth.service';
import { DEVICE_PERMISSION } from './device-permission.decorator';

/**
 * 双通道守卫（导出 / 同步等端点）：mobile 设备签名 **或** web 用户会话。
 *
 * - 设备通道：带 `x-device-id` → Ed25519 验签 + 能力校验，附 req.deviceUser；
 * - 会话通道：否则读 httpOnly cookie 校验（写方法要 CSRF 头）+ 能力校验，附 req.user。
 * 两条都 fail-closed（无 API_TOKEN 兜底、无局域网放行）。所需能力由 @RequireDevicePermission 声明，两通道共用。
 */
@Injectable()
export class DeviceOrSessionGuard implements CanActivate {
  constructor(
    private readonly deviceAuth: DeviceAuthService,
    private readonly account: AccountService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context
      .switchToHttp()
      .getRequest<Request & { deviceUser?: unknown; user?: AuthedUser }>();
    const requiredPerm = this.reflector.getAllAndOverride<PermissionKey | undefined>(
      DEVICE_PERMISSION,
      [context.getHandler(), context.getClass()],
    );

    // 设备通道
    if (req.headers['x-device-id']) {
      const user = await this.deviceAuth.verifyRequest(req, requiredPerm);
      if (!user) throw new UnauthorizedException('设备凭据无效或无权限');
      req.deviceUser = user;
      return true;
    }

    // 会话通道（web 用户带 cookie 也能导出 / 同步）
    const method = (req.method ?? 'GET').toUpperCase();
    const isWrite = method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';
    if (isWrite && req.headers[CSRF_HEADER] !== '1') {
      throw new ForbiddenException('CSRF 校验失败：缺少 X-Radar-Csrf 头');
    }
    const token = readSessionCookie(req);
    if (!token) throw new UnauthorizedException('未登录或缺少设备签名');
    const user = await this.account.resolveSession(token);
    if (!user) throw new UnauthorizedException('会话无效或已过期');
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
