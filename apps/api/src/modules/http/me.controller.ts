import { Body, Controller, Get, HttpException, Patch, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import type { CurrentUser } from '@hatch-radar/shared';
import { AuthUser, type AuthedUser } from '@/modules/account/auth-user.decorator';
import { DeviceOrSessionGuard } from '@/modules/auth/device-or-session.guard';
import { DeviceUser, type DeviceUserContext } from '@/modules/auth/device-permission.decorator';
import { ZodValidationPipe } from '@/common/zod-validation.pipe';
import { AccountService } from '@/domain';

const avatarSchema = z.object({ avatar: z.string().trim().min(1).max(128).nullable() });

/**
 * /api/me —— 设备/会话双通道的「当前用户」端点（移动端取身份 + 改头像）。
 * 设备通道凭 Ed25519 验签即可（仅本人账户，无需特定能力）；会话通道读 httpOnly cookie。
 */
@UseGuards(DeviceOrSessionGuard)
@Controller('me')
export class MeController {
  constructor(private readonly account: AccountService) {}

  /** 双通道取用户 id：设备优先，回退会话；守卫已放行故二者必有其一。 */
  private resolveUserId(device?: DeviceUserContext, session?: AuthedUser): string {
    const id = device?.id ?? session?.id;
    if (!id) throw new HttpException('无法识别当前用户', 401);
    return id;
  }

  /** GET /api/me —— 返回当前用户态（含头像 seed）。 */
  @Get()
  async me(
    @DeviceUser() device?: DeviceUserContext,
    @AuthUser() session?: AuthedUser,
  ): Promise<{ user: CurrentUser }> {
    const user = await this.account.getProfile(this.resolveUserId(device, session));
    if (!user) throw new HttpException('用户不存在', 404);
    return { user };
  }

  /** PATCH /api/me/avatar —— 改本人头像（avatar=null 恢复姓名首字母）。 */
  @Patch('avatar')
  async updateAvatar(
    @Body(new ZodValidationPipe(avatarSchema)) dto: z.infer<typeof avatarSchema>,
    @DeviceUser() device?: DeviceUserContext,
    @AuthUser() session?: AuthedUser,
  ): Promise<{ ok: true }> {
    const result = await this.account.updateAvatarById(
      this.resolveUserId(device, session),
      dto.avatar,
    );
    if (!result.ok) throw new HttpException(result.message, result.status);
    return { ok: true };
  }
}
