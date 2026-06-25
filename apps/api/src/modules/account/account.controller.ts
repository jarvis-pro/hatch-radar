import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { CurrentUser } from '@hatch-radar/shared';
import { AccountService } from './account.service';
import type { AuthedUser } from '@/types/auth-context';
import { AuthUser, Public } from '@/common/auth-user.decorator';
import { AvatarDto, ChangePasswordDto, LoginDto, ProfileDto } from './account.schema';

/**
 * /api/account/* —— 人鉴权权威端点（会话登录/登出/校验/改密/会话管理/资料）。
 * 登录以 @Public 豁免全局守卫；其余端点受全局会话守卫保护（读 Authorization: Bearer 头校验）。
 *
 * 入参 `@Body() dto: XxxDto`（createZodDto 类 + 全局 ZodDtoValidationPipe 校验）。
 */
@ApiTags('account')
@Controller('account')
export class AccountController {
  constructor(
    // 账户领域服务：登录/登出/会话校验/改密/会话管理/资料
    private readonly account: AccountService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
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

  @Get('session')
  session(@AuthUser() user: AuthedUser): { user: CurrentUser } {
    const { sessionId: _sessionId, ...currentUser } = user;

    return { user: currentUser };
  }

  @Post('logout')
  @HttpCode(200)
  async logout(@AuthUser() user: AuthedUser): Promise<{ ok: true }> {
    await this.account.logout(user.sessionId, user.id);

    return { ok: true };
  }

  @Post('change-password')
  @HttpCode(200)
  async changePassword(
    @AuthUser() user: AuthedUser,
    @Body() dto: ChangePasswordDto,
  ): Promise<{ ok: true }> {
    await this.account.changePassword(user, dto.current, dto.password, dto.confirm);

    return { ok: true };
  }

  @Patch('profile')
  async updateProfile(
    @AuthUser() user: AuthedUser,
    @Body() dto: ProfileDto,
  ): Promise<{ ok: true }> {
    await this.account.updateOwnName(user, dto.name);

    return { ok: true };
  }

  @Patch('avatar')
  async updateAvatar(@AuthUser() user: AuthedUser, @Body() dto: AvatarDto): Promise<{ ok: true }> {
    await this.account.updateOwnAvatar(user, dto.avatar);

    return { ok: true };
  }

  @Get('sessions')
  sessions(@AuthUser() user: AuthedUser) {
    return this.account.listSessions(user);
  }

  @Delete('sessions/:id')
  async revokeSession(
    @AuthUser() user: AuthedUser,
    @Param('id') id: string,
  ): Promise<{ ok: true }> {
    await this.account.revokeSession(user, id);

    return { ok: true };
  }

}
