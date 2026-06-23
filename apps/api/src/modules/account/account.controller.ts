import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
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
import { ZodValidationPipe } from '@/common/zod-validation.pipe';
import { AccountService } from './account.service';
import type { AuthedUser } from './auth-context';
import { AuthUser } from './auth-user.decorator';
import { clearSessionCookie, setSessionCookie } from './cookies';
import { SessionAuthGuard } from './session-auth.guard';

/** 登录入参：邮箱（归一为小写）+ 明文口令（服务内比对 scrypt 哈希）。 */
const loginSchema = z.object({
  /** 登录邮箱；trim 去空白、toLowerCase 归一，避免大小写 / 空格导致查不到账户 */
  email: z.string().trim().toLowerCase(),
  /** 明文口令，交服务做 scrypt 校验（不在此处限长，避免泄露口令策略） */
  password: z.string(),
});

/** 改密入参：旧口令 + 新口令 + 确认；三者一致性与强度在服务内校验。 */
const changePasswordSchema = z.object({
  /** 当前口令，先校验本人身份再放行改密 */
  current: z.string(),
  /** 新口令明文 */
  password: z.string(),
  /** 再次输入的新口令，服务内须与 password 完全一致 */
  confirm: z.string(),
});

/** 改资料入参：仅姓名（trim 后非空）。 */
const profileSchema = z.object({
  /** 展示用姓名，去空白后必填 */
  name: z.string().trim().min(1),
});

/** 改头像入参：DiceBear seed 字符串，或 null 恢复姓名首字母。 */
const avatarSchema = z.object({
  /** 头像 seed（≤128 字符）；null=清除自定义头像、回落首字母 */
  avatar: z.string().trim().min(1).max(128).nullable(),
});

/** 剥离 AuthedUser 内部的 sessionId，得到对外的 CurrentUser（解构丢弃，避免会话 id 泄露进响应体）。 */
function toCurrentUser({ sessionId: _sessionId, ...user }: AuthedUser): CurrentUser {
  return user;
}

/**
 * /api/auth/* —— 人鉴权权威端点（会话登录/登出/校验/改密/会话管理/资料）。
 * 登录公开；其余挂 SessionAuthGuard（读 httpOnly cookie 校验）。设备激活在另一控制器 /api/auth/device。
 */
@Controller('auth')
export class AccountController {
  constructor(private readonly account: AccountService) {}

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
      ip: req.ip,
    });
    setSessionCookie(res, result.token, result.absoluteDays);

    return { user: result.user };
  }

  /** GET /api/auth/session —— 返回当前用户态（SPA 进站取一次 + 路由守卫）。 */
  @Get('session')
  @UseGuards(SessionAuthGuard)
  session(@AuthUser() user: AuthedUser): { user: CurrentUser } {
    return { user: toCurrentUser(user) };
  }

  /** POST /api/auth/logout —— 吊销当前会话 + 过期 cookie（会话已由守卫解析，凭 sessionId 直接删）。 */
  @Post('logout')
  @HttpCode(200)
  @UseGuards(SessionAuthGuard)
  async logout(
    @AuthUser() user: AuthedUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: true }> {
    await this.account.logout(user.sessionId, user.id);
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
    await this.account.changePassword(user, dto.current, dto.password, dto.confirm);

    return { ok: true };
  }

  /** PATCH /api/auth/profile —— 改本人姓名。 */
  @Patch('profile')
  @UseGuards(SessionAuthGuard)
  async updateProfile(
    @AuthUser() user: AuthedUser,
    @Body(new ZodValidationPipe(profileSchema)) dto: z.infer<typeof profileSchema>,
  ): Promise<{ ok: true }> {
    await this.account.updateOwnName(user, dto.name);

    return { ok: true };
  }

  /** PATCH /api/auth/avatar —— 改本人头像（DiceBear seed；avatar=null 恢复首字母）。 */
  @Patch('avatar')
  @UseGuards(SessionAuthGuard)
  async updateAvatar(
    @AuthUser() user: AuthedUser,
    @Body(new ZodValidationPipe(avatarSchema)) dto: z.infer<typeof avatarSchema>,
  ): Promise<{ ok: true }> {
    await this.account.updateOwnAvatar(user, dto.avatar);

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
