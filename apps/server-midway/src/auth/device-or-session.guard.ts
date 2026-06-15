import {
  getClassMetadata,
  getPropertyMetadata,
  Guard,
  httpError,
  type IGuard,
  Inject,
} from '@midwayjs/core';
import type { Context } from '@midwayjs/koa';
import { type AccountService, type DeviceAuthService } from '@hatch-radar/core';
import { hasPermission, type PermissionKey } from '@hatch-radar/shared';
import type { AuthedUser } from '@/account/auth-user.decorator';
import { CSRF_HEADER, readSessionCookie } from '@/account/cookies';
import { TOK } from '@/common/tokens';
import { DEVICE_PERMISSION, type DeviceUserContext } from './device-permission.decorator';

/**
 * 双通道守卫（导出 / 同步等端点）：mobile 设备签名 **或** web 用户会话。与 NestJS 版逐条等价：
 *
 * - 设备通道：带 `x-device-id` → Ed25519 验签 + 能力校验，附 ctx.deviceUser；
 * - 会话通道：否则读 httpOnly cookie 校验（写方法要 CSRF 头）+ 能力校验，附 ctx.user。
 * 两条都 fail-closed。所需能力由 @RequireDevicePermission 声明（方法级覆盖类级），两通道共用。
 */
@Guard()
export class DeviceOrSessionGuard implements IGuard<Context> {
  @Inject(TOK.deviceAuth)
  deviceAuth!: DeviceAuthService;

  @Inject(TOK.account)
  account!: AccountService;

  async canActivate(
    ctx: Context,
    supplierClz: new (...args: any[]) => any,
    methodName: string,
  ): Promise<boolean> {
    const requiredPerm =
      getPropertyMetadata<PermissionKey | undefined>(DEVICE_PERMISSION, supplierClz, methodName) ??
      getClassMetadata<PermissionKey | undefined>(DEVICE_PERMISSION, supplierClz);

    // 设备通道
    if (ctx.headers['x-device-id']) {
      const user = await this.deviceAuth.verifyRequest(ctx, requiredPerm);
      if (!user) throw new httpError.UnauthorizedError('设备凭据无效或无权限');
      (ctx as Context & { deviceUser?: DeviceUserContext }).deviceUser = user;
      return true;
    }

    // 会话通道（web 用户带 cookie 也能导出 / 同步）
    const method = (ctx.method ?? 'GET').toUpperCase();
    const isWrite = method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';
    if (isWrite && ctx.headers[CSRF_HEADER] !== '1') {
      throw new httpError.ForbiddenError('CSRF 校验失败：缺少 X-Radar-Csrf 头');
    }
    const token = readSessionCookie(ctx);
    if (!token) throw new httpError.UnauthorizedError('未登录或缺少设备签名');
    const user = await this.account.resolveSession(token);
    if (!user) throw new httpError.UnauthorizedError('会话无效或已过期');
    if (
      requiredPerm &&
      !hasPermission(user.role, user.permissions, requiredPerm, user.status === 'active')
    ) {
      throw new httpError.ForbiddenError('无权访问');
    }
    (ctx as Context & { user?: AuthedUser }).user = user;
    return true;
  }
}
