import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  Inject,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import type { CurrentUser } from '@hatch-radar/shared';
import { APP_ENV } from '@/common/tokens';
import type { AppEnv } from '@/config/env';
import { ZodValidationPipe } from '@/common/zod-validation.pipe';
import { AccountService } from './account.service';
import { AuthUser, type AuthedUser } from './auth-user.decorator';
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

/** 取客户端 IP（反代场景取 x-forwarded-for 首段，否则 express req.ip）。 */
function clientIp(req: Request): string | undefined {
  const xff = req.headers['x-forwarded-for'];
  const raw = Array.isArray(xff) ? xff[0] : xff;
  if (raw) return raw.split(',')[0]?.trim() || undefined;
  return req.ip;
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
 * 登录公开；其余挂 SessionAuthGuard（读 httpOnly cookie 校验）。设备激活在另一控制器 /api/auth/device。
 */
@Controller('auth')
export class AccountController {
  constructor(
    @Inject(APP_ENV) private readonly env: AppEnv,
    private readonly account: AccountService,
  ) {}

  /** POST /api/auth/login —— 校验后 Set-Cookie: radar_session（HttpOnly），返回用户态。 */
  @Post('login')
  @HttpCode(200)
  async login(
    @Body(new ZodValidationPipe(loginSchema)) dto: z.infer<typeof loginSchema>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ user: CurrentUser }> {
    const result = await this.account.login(dto.email, dto.password, {
      userAgent: req.headers['user-agent'],
      ip: clientIp(req),
    });
    if (!result.ok) throw new HttpException(result.message, result.status);
    setSessionCookie(res, result.token, this.env.session.absoluteDays);
    return { user: result.user };
  }

  /** GET /api/auth/session —— 返回当前用户态（SPA 进站取一次 + 路由守卫）。 */
  @Get('session')
  @UseGuards(SessionAuthGuard)
  session(@AuthUser() user: AuthedUser): { user: CurrentUser } {
    return { user: toCurrentUser(user) };
  }

  /** POST /api/auth/logout —— 吊销当前会话 + 过期 cookie。 */
  @Post('logout')
  @HttpCode(200)
  @UseGuards(SessionAuthGuard)
  async logout(
    @AuthUser() user: AuthedUser,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: true }> {
    const token = readSessionCookie(req);
    if (token) await this.account.logout(token, user.id);
    clearSessionCookie(res);
    return { ok: true };
  }

  /** POST /api/auth/change-password —— 校验当前密码后改密，吊销其余会话。 */
  @Post('change-password')
  @HttpCode(200)
  @UseGuards(SessionAuthGuard)
  async changePassword(
    @AuthUser() user: AuthedUser,
    @Body(new ZodValidationPipe(changePasswordSchema)) dto: z.infer<typeof changePasswordSchema>,
  ): Promise<{ ok: true }> {
    const result = await this.account.changePassword(user, dto.current, dto.password, dto.confirm);
    if (!result.ok) throw new HttpException(result.message, result.status);
    return { ok: true };
  }

  /** PATCH /api/auth/profile —— 改本人姓名。 */
  @Patch('profile')
  @UseGuards(SessionAuthGuard)
  async updateProfile(
    @AuthUser() user: AuthedUser,
    @Body(new ZodValidationPipe(profileSchema)) dto: z.infer<typeof profileSchema>,
  ): Promise<{ ok: true }> {
    const result = await this.account.updateOwnName(user, dto.name);
    if (!result.ok) throw new HttpException(result.message, result.status);
    return { ok: true };
  }

  /** GET /api/auth/sessions —— 本人当前会话列表（标记当前会话）。 */
  @Get('sessions')
  @UseGuards(SessionAuthGuard)
  sessions(@AuthUser() user: AuthedUser) {
    return this.account.listSessions(user);
  }

  /** DELETE /api/auth/sessions/:id —— 登出指定会话（仅本人）。 */
  @Delete('sessions/:id')
  @UseGuards(SessionAuthGuard)
  async revokeSession(
    @AuthUser() user: AuthedUser,
    @Param('id') id: string,
  ): Promise<{ ok: true }> {
    await this.account.revokeSession(user, id);
    return { ok: true };
  }

  /** POST /api/auth/sessions/revoke-others —— 登出除当前外的其它会话。 */
  @Post('sessions/revoke-others')
  @HttpCode(200)
  @UseGuards(SessionAuthGuard)
  async revokeOthers(@AuthUser() user: AuthedUser): Promise<{ ok: true }> {
    await this.account.revokeOtherSessions(user);
    return { ok: true };
  }
}
