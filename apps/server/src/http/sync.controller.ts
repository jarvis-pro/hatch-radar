import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import type { z } from 'zod';
import { BearerAuthGuard } from '@/common/bearer-auth.guard';
import { ZodValidationPipe } from '@/common/zod-validation.pipe';
import { pushEnvelopeSchema, SyncService } from '@/sync/sync.service';

/**
 * POST /api/sync/push —— 接收移动端 outbox 操作并按 op_id 幂等应用（规格 §D）。
 * 请求体上限由全局 body 限制把控（5MB，对应裸跑实现）。
 */
@UseGuards(BearerAuthGuard)
@Controller('sync')
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  @Post('push')
  @HttpCode(200)
  async push(
    @Body(new ZodValidationPipe(pushEnvelopeSchema)) body: z.infer<typeof pushEnvelopeSchema>,
  ) {
    return this.sync.applySyncPush(body.deviceId, body.ops);
  }
}
