import { Module } from '@nestjs/common';
import { SyncService } from './sync.service';

/**
 * 同步模块：接收移动端 outbox 操作并按 op_id 幂等应用（SyncService 直接注入 DRIZZLE）。
 */
@Module({
  providers: [SyncService],
  exports: [SyncService],
})
export class SyncModule {}
