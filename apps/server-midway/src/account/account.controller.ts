import {
  Controller,
  Del,
  Get,
  HttpCode,
  Inject,
  MidwayHttpError,
  Param,
  Patch,
  Post,
  UseGuard,
} from '@midwayjs/core';
import type { Context } from '@midwayjs/koa';
import { z } from 'zod';
import { type AccountService } from '@hatch-radar/core';
import type { CurrentUser } from '@hatch-radar/shared';
import { AuthUser, ValidBody } from '@/common/params';
import { TOK } from '@/common/tokens';
import { type AuthedUser } from './auth-user.decorator';
import { clearSessionCookie, readSessionCookie, setSessionCookie } from './cookies';
import { SessionAuthGuard } from './session-auth.guard';

const loginSchema = z.object({
  email: z.string().trim().toLowerCase(),
  password: z.string(),
});

const changePasswordSchema = z.object({
  current: z.string(),
  password: z.string(),
  confirm: z.string(),
});

const profileSchema = z.object({ name: z.string().trim().min(1) });

/** 取客户端 IP（反代场景取 x-forwarded-for 首段，否则 koa ctx.ip）。 */
function clientIp(ctx: Context): string | undefined {
  const xff = ctx.headers['x-forwarded-for'];
  const raw = Array.isArray(xff) ? xff[0] : xff;
  if (raw) return raw.split(',')[0]?.trim() || undefined;
  return ctx.ip;
}

function toCurrentUser(user: AuthedUser): CurrentUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    status: user.status,
    mustChangePassword: user.mustChangePassword,
    permissions: user.permissions,
  };
}

/**
 * /api/auth/* —— 人鉴权权威端点（会话登录/登出/校验/改密/会话管理/资料）。
 * 登录公开；其余挂 SessionAuthGuard。设备激活在另一控制器 /api/auth/device。
 * cookie 经注入的 koa ctx 读写（对应 NestJS 版 @Res({passthrough})）。
 */
@Controller('/auth')
export class AccountController {
  @Inject(TOK.account)
  account!: AccountService;

  @Inject()
  ctx!: Context;

  /** POST /api/auth/login —— 校验后 Set-Cookie: radar_session（HttpOnly），返回用户态。 */
  @Post('/login')
  @HttpCode(200)
  async login(@ValidBody(loginSchema) dto: z.infer<typeof loginSchema>): Promise<{ user: CurrentUser }> {
    const result = await this.account.login(dto.email, dto.password, {
      userAgent: this.ctx.headers['user-agent'],
      ip: clientIp(this.ctx),
    });
    if (!result.ok) throw new MidwayHttpError(result.message, result.status);
    setSessionCookie(this.ctx, result.token, result.absoluteDays);
    return { user: result.user };
  }

  /** GET /api/auth/session —— 返回当前用户态。 */
  @Get('/session')
  @UseGuard(SessionAuthGuard)
  // eslint-disable-next-line @typescript-eslint/require-await
  async session(@AuthUser() user: AuthedUser): Promise<{ user: CurrentUser }> {
    return { user: toCurrentUser(user) };
  }

  /** POST /api/auth/logout —— 吊销当前会话 + 过期 cookie。 */
  @Post('/logout')
  @HttpCode(200)
  @UseGuard(SessionAuthGuard)
  async logout(@AuthUser() user: AuthedUser): Promise<{ ok: true }> {
    const token = readSessionCookie(this.ctx);
    if (token) await this.account.logout(token, user.id);
    clearSessionCookie(this.ctx);
    return { ok: true };
  }

  /** POST /api/auth/change-password —— 校验当前密码后改密，吊销其余会话。 */
  @Post('/change-password')
  @HttpCode(200)
  @UseGuard(SessionAuthGuard)
  async changePassword(
    @AuthUser() user: AuthedUser,
    @ValidBody(changePasswordSchema) dto: z.infer<typeof changePasswordSchema>,
  ): Promise<{ ok: true }> {
    const result = await this.account.changePassword(user, dto.current, dto.password, dto.confirm);
    if (!result.ok) throw new MidwayHttpError(result.message, result.status);
    return { ok: true };
  }

  /** PATCH /api/auth/profile —— 改本人姓名。 */
  @Patch('/profile')
  @UseGuard(SessionAuthGuard)
  async updateProfile(
    @AuthUser() user: AuthedUser,
    @ValidBody(profileSchema) dto: z.infer<typeof profileSchema>,
  ): Promise<{ ok: true }> {
    const result = await this.account.updateOwnName(user, dto.name);
    if (!result.ok) throw new MidwayHttpError(result.message, result.status);
    return { ok: true };
  }

  /** GET /api/auth/sessions —— 本人当前会话列表（标记当前会话）。 */
  @Get('/sessions')
  @UseGuard(SessionAuthGuard)
  async sessions(@AuthUser() user: AuthedUser) {
    return await this.account.listSessions(user);
  }

  /** DELETE /api/auth/sessions/:id —— 登出指定会话（仅本人）。 */
  @Del('/sessions/:id')
  @UseGuard(SessionAuthGuard)
  async revokeSession(@AuthUser() user: AuthedUser, @Param('id') id: string): Promise<{ ok: true }> {
    await this.account.revokeSession(user, id);
    return { ok: true };
  }

  /** POST /api/auth/sessions/revoke-others —— 登出除当前外的其它会话。 */
  @Post('/sessions/revoke-others')
  @HttpCode(200)
  @UseGuard(SessionAuthGuard)
  async revokeOthers(@AuthUser() user: AuthedUser): Promise<{ ok: true }> {
    await this.account.revokeOtherSessions(user);
    return { ok: true };
  }
}
