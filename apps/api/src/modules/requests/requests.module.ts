import { Module } from '@nestjs/common';
import { RequestsController } from './requests.controller';
import { AccountModule } from '@/modules/account/account.module';

/**
 * 出站请求闸上下文：`/api/requests` 请求队列视图 + lane 暂停（RequestQueue / Lanes 仓储，全局；
 * 闸能力 RequestGate 在 CapabilityModule）。走 SessionAuthGuard，故 import AccountModule。
 */
@Module({
  imports: [AccountModule],
  controllers: [RequestsController],
})
export class RequestsModule {}
