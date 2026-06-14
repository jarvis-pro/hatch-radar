import { Global, Module } from '@nestjs/common';
import { RepositoriesModule } from '@/db/repositories.module';
import { GatewayService } from './gateway.service';

/**
 * Push 网关模块（全局）：HTTP 进程中运行，维护 worker 注册表并主动分发任务。
 *
 * @Global() 使 GatewayService 在整个应用可注入（如 AnalysisConfigService 入队后立即触发分发），
 * 无需各模块显式 import 此模块——只在 AppModule 导入一次即可。
 */
@Global()
@Module({
  imports: [RepositoriesModule],
  providers: [GatewayService],
  exports: [GatewayService],
})
export class GatewayModule {}
