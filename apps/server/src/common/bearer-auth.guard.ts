import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { APP_ENV } from './tokens';
import type { AppEnv } from '../config/env';

/**
 * Bearer Token 鉴权守卫（局域网信任模式）。
 * - 未配置 API_TOKEN 时直接放行（与裸跑实现一致）
 * - 配置后要求 `Authorization: Bearer <token>`，否则 401
 *
 * 健康检查不挂此守卫（公开探测）。
 */
@Injectable()
export class BearerAuthGuard implements CanActivate {
  constructor(@Inject(APP_ENV) private readonly env: AppEnv) {}

  canActivate(context: ExecutionContext): boolean {
    const token = this.env.http.token;
    if (!token) return true;
    const req = context
      .switchToHttp()
      .getRequest<{ headers: Record<string, string | undefined> }>();
    if (req.headers.authorization === `Bearer ${token}`) return true;
    throw new UnauthorizedException('unauthorized：请携带 Authorization: Bearer <API_TOKEN>');
  }
}
