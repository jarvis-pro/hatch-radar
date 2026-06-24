import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { CurrentUser } from '@hatch-radar/shared';
import { ZodResponse } from '@/common/zod-response.decorator';
import { AccountService } from './account.service';
import type { AuthedUser } from '@/types/auth-context';
import { AuthUser, Public } from '@/common/auth-user.decorator';
import {
  AvatarDto,
  ChangePasswordDto,
  LoginDto,
  loginEnvelopeSchema,
  okSchema,
  ProfileDto,
  userEnvelopeSchema,
} from './account.schema';

/** 剥离 AuthedUser 内部的 sessionId，得到对外的 CurrentUser（解构丢弃，避免会话 id 泄露进响应体）。 */
function toCurrentUser({ sessionId: _sessionId, ...user }: AuthedUser): CurrentUser {
  return user;
}

/**
 * /api/auth/* —— 人鉴权权威端点（会话登录/登出/校验/改密/会话管理/资料）。
 * 登录以 @Public 豁免全局守卫；其余端点受全局会话守卫保护（读 Authorization: Bearer 头校验）。
 *
 * 入参 `@Body() dto: XxxDto`（createZodDto 类 + 全局 ZodDtoValidationPipe 校验）、出参
 * `@ZodResponse(xxxSchema)`（文档 + 出站序列化）；全仓控制器已统一此 nestjs-zod 请求方案，
 * 响应序列化目前仅本控制器接入。
 */
@ApiTags('account')
@Controller('auth')
export class AccountController {
  constructor(
    // 账户领域服务：登录/登出/会话校验/改密/会话管理/资料
    private readonly account: AccountService,
  ) {}

  /** POST /api/auth/login —— 校验凭据，返回用户态与会话 token（客户端自行持久化）。 */
  @Public()
  @Post('login')
  @HttpCode(200)
  @ZodResponse(loginEnvelopeSchema)
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
  ): Promise<{ user: CurrentUser; token: string }> {
    const result = await this.account.login(dto.email, dto.password, {
      userAgent: req.headers['user-agent'],
      ip: req.ip,
    });

    return { user: result.user, token: result.token };
  }

  /** GET /api/auth/session —— 返回当前用户态（SPA 进站取一次 + 路由守卫）。 */
  @Get('session')
  @ZodResponse(userEnvelopeSchema)
  session(@AuthUser() user: AuthedUser): { user: CurrentUser } {
    return { user: toCurrentUser(user) };
  }

  /** POST /api/auth/logout —— 吊销当前会话（客户端负责清除本地 token）。 */
  @Post('logout')
  @HttpCode(200)
  @ZodResponse(okSchema)
  async logout(@AuthUser() user: AuthedUser): Promise<{ ok: true }> {
    await this.account.logout(user.sessionId, user.id);

    return { ok: true };
  }

  /** POST /api/auth/change-password —— 校验当前密码后改密，吊销其余会话。 */
  @Post('change-password')
  @HttpCode(200)
  @ZodResponse(okSchema)
  async changePassword(
    @AuthUser() user: AuthedUser,
    @Body() dto: ChangePasswordDto,
  ): Promise<{ ok: true }> {
    await this.account.changePassword(user, dto.current, dto.password, dto.confirm);

    return { ok: true };
  }

  /** PATCH /api/auth/profile —— 改本人昵称。 */
  @Patch('profile')
  @ZodResponse(okSchema)
  async updateProfile(
    @AuthUser() user: AuthedUser,
    @Body() dto: ProfileDto,
  ): Promise<{ ok: true }> {
    await this.account.updateOwnName(user, dto.name);

    return { ok: true };
  }

  /** PATCH /api/auth/avatar —— 改本人头像（DiceBear seed；avatar=null 恢复首字母）。 */
  @Patch('avatar')
  @ZodResponse(okSchema)
  async updateAvatar(
    @AuthUser() user: AuthedUser,
    @Body() dto: AvatarDto,
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
