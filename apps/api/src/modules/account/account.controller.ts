import { Controller, Delete, Get, HttpCode, Param, Patch, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { CurrentUser } from '@hatch-radar/shared';
import { ZodBody } from '@/common/zod-body.decorator';
import { AccountService } from './account.service';
import type { AuthedUser } from '@/types/auth-context';
import { AuthUser, Public } from './auth-user.decorator';
import { clearSessionCookie, setSessionCookie } from './cookies';
import { avatarSchema, changePasswordSchema, loginSchema, profileSchema } from './account.schema';
import type { AvatarDto, ChangePasswordDto, LoginDto, ProfileDto } from './account.schema';

/** 剥离 AuthedUser 内部的 sessionId，得到对外的 CurrentUser（解构丢弃，避免会话 id 泄露进响应体）。 */
function toCurrentUser({ sessionId: _sessionId, ...user }: AuthedUser): CurrentUser {
  return user;
}

/**
 * /api/auth/* —— 人鉴权权威端点（会话登录/登出/校验/改密/会话管理/资料）。
 * 登录以 @Public 豁免全局守卫；其余端点受全局会话守卫保护（读 httpOnly cookie 校验）。
 */
@Controller('auth')
export class AccountController {
  constructor(
    // 账户领域服务：登录/登出/会话校验/改密/会话管理/资料
    private readonly account: AccountService,
  ) {}

  /** POST /api/auth/login —— 校验后 Set-Cookie: radar_session（HttpOnly），返回用户态。 */
  @Public()
  @Post('login')
  @HttpCode(200)
  async login(
    @ZodBody(loginSchema) dto: LoginDto,
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
  session(@AuthUser() user: AuthedUser): { user: CurrentUser } {
    return { user: toCurrentUser(user) };
  }

  /** POST /api/auth/logout —— 吊销当前会话 + 过期 cookie（会话已由守卫解析，凭 sessionId 直接删）。 */
  @Post('logout')
  @HttpCode(200)
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
  async changePassword(
    @AuthUser() user: AuthedUser,
    @ZodBody(changePasswordSchema) dto: ChangePasswordDto,
  ): Promise<{ ok: true }> {
    await this.account.changePassword(user, dto.current, dto.password, dto.confirm);

    return { ok: true };
  }

  /** PATCH /api/auth/profile —— 改本人昵称。 */
  @Patch('profile')
  async updateProfile(
    @AuthUser() user: AuthedUser,
    @ZodBody(profileSchema) dto: ProfileDto,
  ): Promise<{ ok: true }> {
    await this.account.updateOwnName(user, dto.name);

    return { ok: true };
  }

  /** PATCH /api/auth/avatar —— 改本人头像（DiceBear seed；avatar=null 恢复首字母）。 */
  @Patch('avatar')
  async updateAvatar(
    @AuthUser() user: AuthedUser,
    @ZodBody(avatarSchema) dto: AvatarDto,
  ): Promise<{ ok: true }> {
    await this.account.updateOwnAvatar(user, dto.avatar);

    return { ok: true };
  }

  /** GET /api/auth/sessions —— 本人当前会话列表（标记当前会话）。 */
  @Get('sessions')
  sessions(@AuthUser() user: AuthedUser) {
    return this.account.listSessions(user);
  }

  /** DELETE /api/auth/sessions/:id —— 登出指定会话（仅本人）。 */
  @Delete('sessions/:id')
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
  async revokeOthers(@AuthUser() user: AuthedUser): Promise<{ ok: true }> {
    await this.account.revokeOtherSessions(user);

    return { ok: true };
  }
}
