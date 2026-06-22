import { Module } from '@nestjs/common';
import { SyncService } from './sync.service';

/**
 * 移动端离线研判回传上下文（/api/sync/push 按 opId 幂等）。叶子模块：仅依赖全局持久层。
 */
@Module({
  providers: [SyncService],
  exports: [SyncService],
})
export class SyncModule {}
