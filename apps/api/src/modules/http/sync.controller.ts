import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import type { z } from 'zod';
import {
  DeviceUser,
  RequireDevicePermission,
  type DeviceUserContext,
} from '@/modules/auth/device-permission.decorator';
import { DeviceOrSessionGuard } from '@/modules/auth/device-or-session.guard';
import { ZodValidationPipe } from '@/common/zod-validation.pipe';
import { DeviceAuthService, pushEnvelopeSchema, SyncService } from '@/domain';

/**
 * POST /api/sync/push —— 接收移动端 outbox 操作并按 op_id 幂等应用（规格 §D）。
 * 鉴权走双通道守卫：mobile 用设备签名（需 insights:triage 能力），并把本次同步归属到设备所属账户写审计。
 * 请求体上限由全局 body 限制把控（5MB，对应裸跑实现）。
 */
@UseGuards(DeviceOrSessionGuard)
@RequireDevicePermission('insights:triage')
@Controller('sync')
export class SyncController {
  constructor(
    private readonly sync: SyncService,
    private readonly deviceAuth: DeviceAuthService,
  ) {}

  @Post('push')
  @HttpCode(200)
  async push(
    @Body(new ZodValidationPipe(pushEnvelopeSchema)) body: z.infer<typeof pushEnvelopeSchema>,
    @DeviceUser() user?: DeviceUserContext,
  ) {
    const result = await this.sync.applySyncPush(body.deviceId, body.ops);
    if (user) {
      await this.deviceAuth.recordAudit({
        actorId: user.id,
        action: 'sync.push',
        targetType: 'device',
        targetId: user.credentialId,
        metadata: { ops: body.ops.length },
      });
    }
    return result;
  }
}
