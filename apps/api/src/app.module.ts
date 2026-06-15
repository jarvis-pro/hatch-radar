import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { AccountModule } from './account/account.module';
import { AdminModule } from './admin/admin.module';
import { AppConfigModule } from './config/app-config.module';
import { CoreModule } from './core/core.module';
import { DataModule } from './data/data.module';
import { DatabaseModule } from './database/database.module';
import { GatewayModule } from './gateway/gateway.module';
import { HttpModule } from './http/http.module';
import { logger } from './logger';
import { SchedulerModule } from './scheduler/scheduler.module';
import { SeedModule } from './seed/seed.module';
import { StaticModule } from './static/static.module';
import { WorkerModule } from './worker/worker.module';

/** 是否在主进程内同进程跑 worker（默认 true）；设 WORKER_IN_PROCESS=false 拆到独立进程 */
function workerInProcess(): boolean {
  return process.env.WORKER_IN_PROCESS?.trim() !== 'false';
}

/**
 * 主进程根模块：HTTP（导出/同步/设置/分析/健康）+ 定时调度 + push 网关 + （默认）同进程 worker。
 *
 * 领域逻辑全在 @/domain：CoreModule（@Global）用 createCore 一处装配、按类登记,处处可按类型注入；
 * 各功能模块只留控制器/守卫与生命周期薄封装。SeedModule 须排在 SchedulerModule 之前（先播种再初始轮）。
 */
@Module({
  imports: [
    LoggerModule.forRoot({ pinoHttp: { logger, autoLogging: false } }),
    AppConfigModule,
    DatabaseModule,
    CoreModule,
    AccountModule,
    SeedModule,
    DataModule,
    AdminModule,
    GatewayModule,
    HttpModule,
    SchedulerModule,
    StaticModule.forRoot(),
    ...(workerInProcess() ? [WorkerModule] : []),
  ],
})
export class AppModule {}
