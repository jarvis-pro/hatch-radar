import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { PermissionKey } from '@hatch-radar/shared';
import { APP_ENV } from '@/common/tokens';
import type { AppEnv } from '@/config/env';
import { DeviceAuthService } from './device-auth.service';
import { DEVICE_PERMISSION } from './device-permission.decorator';

/**
 * 双通道守卫（导出 / 同步等 mobile↔server 端点用）：
 * - 设备通道：带 `x-device-id` → Ed25519 验签 + 能力校验，附 req.deviceUser；
 * - 服务通道：否则按共享 `API_TOKEN` 校验（web 代理）；未配置 token 则放行（局域网信任）。
 */
@Injectable()
export class MachineOrDeviceGuard implements CanActivate {
  constructor(
    @Inject(APP_ENV) private readonly env: AppEnv,
    private readonly deviceAuth: DeviceAuthService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
      method?: string;
      originalUrl?: string;
      url?: string;
      deviceUser?: unknown;
    }>();

    if (req.headers['x-device-id']) {
      const requiredPerm = this.reflector.getAllAndOverride<PermissionKey | undefined>(
        DEVICE_PERMISSION,
        [context.getHandler(), context.getClass()],
      );
      const user = await this.deviceAuth.verifyRequest(req, requiredPerm);
      if (!user) throw new UnauthorizedException('设备凭据无效或无权限');
      req.deviceUser = user;
      return true;
    }

    const token = this.env.http.token;
    if (!token) return true;
    if (req.headers.authorization === `Bearer ${token}`) return true;
    throw new UnauthorizedException(
      'unauthorized：请携带设备签名或 Authorization: Bearer <API_TOKEN>',
    );
  }
}
