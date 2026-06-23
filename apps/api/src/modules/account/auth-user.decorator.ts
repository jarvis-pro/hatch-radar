import { type ExecutionContext, SetMetadata, createParamDecorator } from '@nestjs/common';
import type { PermissionKey } from '@hatch-radar/shared';
import type { AuthedUser } from './auth-context';

/** 路由所需能力 key 的元数据键。 */
export const REQUIRE_PERMISSION = 'require_permission';

/** 标注某路由所需的能力（SessionAuthGuard 据此做能力闸，super_admin 隐式全通）。 */
export const RequirePermission = (key: PermissionKey) => SetMetadata(REQUIRE_PERMISSION, key);

/**
 * 取当前登录用户（由 SessionAuthGuard、或 DeviceOrSessionGuard 的会话分支附加到 req.user）。
 *
 * 返回 undefined 表示当前请求未走会话通道——双通道端点改走设备签名时 req.user 为空（身份在 req.deviceUser），
 * 或路由漏挂守卫。故类型如实标可空：纯会话端点配 SessionAuthGuard 后调用方可安全断言非空，
 * 双通道端点须自行收窄（见 MeController 的 resolveUserId）。
 */
export const AuthUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthedUser | undefined =>
    ctx.switchToHttp().getRequest<{ user?: AuthedUser }>().user,
);
