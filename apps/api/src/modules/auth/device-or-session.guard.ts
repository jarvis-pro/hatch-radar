import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { PermissionKey } from '@hatch-radar/shared';
import { DeviceAuthService } from './device-auth.service';
import { SessionAuthenticator } from '@/modules/account/session-authenticator';
import type { AuthedUser } from '@/modules/account/auth-user.decorator';
import { DEVICE_PERMISSION } from './device-permission.decorator';

/**
 * 双通道守卫（导出 / 同步等端点）：mobile 设备签名 **或** web 用户会话。
 *
 * - 设备通道：带 `x-device-id` → Ed25519 验签 + 能力校验，附 req.deviceUser；
 * - 会话通道：否则复用 {@link SessionAuthenticator}（与 SessionAuthGuard 同一实现，杜绝 CSRF /
 *   会话逻辑两处分叉），附 req.user。
 * 两条都 fail-closed（无匿名兜底、无局域网放行）。所需能力由 @RequireDevicePermission 声明，两通道共用。
 */
@Injectable()
export class DeviceOrSessionGuard implements CanActivate {
  constructor(
    private readonly deviceAuth: DeviceAuthService,
    private readonly authenticator: SessionAuthenticator,
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
      if (!user) {
        throw new UnauthorizedException('设备凭据无效或无权限');
      }

      req.deviceUser = user;

      return true;
    }

    // 会话通道（web 用户带 cookie 也能导出 / 同步）
    req.user = await this.authenticator.authenticate(req, requiredPerm, '未登录或缺少设备签名');

    return true;
  }
}
