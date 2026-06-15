import { Controller, HttpCode, Inject, Post, UseGuard } from '@midwayjs/core';
import type { z } from 'zod';
import { pushEnvelopeSchema, type DeviceAuthService, type SyncService } from '@hatch-radar/core';
import { DeviceOrSessionGuard } from '@/auth/device-or-session.guard';
import { RequireDevicePermission, type DeviceUserContext } from '@/auth/device-permission.decorator';
import { DeviceUser, ValidBody } from '@/common/params';
import { TOK } from '@/common/tokens';

/**
 * POST /api/sync/push —— 接收移动端 outbox 操作并按 op_id 幂等应用。
 * 双通道守卫：mobile 设备签名（需 insights:triage）或 web 会话；设备通道额外写审计。
 * 请求体上限 5MB（全局 bodyParser），与 NestJS 版一致。POST 由 @HttpCode(200) 固定。
 */
@UseGuard(DeviceOrSessionGuard)
@RequireDevicePermission('insights:triage')
@Controller('/sync')
export class SyncController {
  @Inject(TOK.sync)
  sync!: SyncService;

  @Inject(TOK.deviceAuth)
  deviceAuth!: DeviceAuthService;

  @Post('/push')
  @HttpCode(200)
  async push(
    @ValidBody(pushEnvelopeSchema) body: z.infer<typeof pushEnvelopeSchema>,
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
