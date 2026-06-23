import { Body, Controller, Post, UnauthorizedException } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '@/common/zod-validation.pipe';
import { DeviceAuthService } from './device-auth.service';

const enrollSchema = z.object({
  /** 管理员发的一次性激活码。 */
  code: z.string().trim().min(1),
  /** 设备展示名（可选，覆盖激活码里的预设名）。 */
  deviceName: z.string().trim().optional(),
  /** 设备本地生成的 Ed25519 公钥（base64，32 字节原始）。 */
  publicKey: z.string().trim().min(1),
});

/**
 * /api/auth/device/* —— 设备激活（公开端点，由一次性激活码自鉴权，不挂 token / 设备守卫）。
 */
@Controller('auth/device')
export class AuthController {
  constructor(private readonly deviceAuth: DeviceAuthService) {}

  /** 用激活码 + 设备公钥换取凭据 id；码无效 / 已用 / 过期返回 401（不泄露原因）。 */
  @Post('enroll')
  async enroll(@Body(new ZodValidationPipe(enrollSchema)) body: z.infer<typeof enrollSchema>) {
    const result = await this.deviceAuth.enroll(body);
    if (!result) {
      throw new UnauthorizedException('激活码无效或已过期');
    }

    return result;
  }
}
