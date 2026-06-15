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

/**
 * 控制面根模块：HTTP（导出/同步/设置/分析/健康）+ 定时调度 + push 网关 + 同源托管 web SPA。
 *
 * 领域逻辑全在 @/domain：CoreModule（@Global）用 createCore 一处装配、按类登记,处处可按类型注入；
 * 各功能模块只留控制器/守卫与生命周期薄封装。SeedModule 须排在 SchedulerModule 之前（先播种再初始轮）。
 * 分析执行（worker）已拆为独立进程 apps/worker，经 GatewayModule 的 WS 网关认领任务。
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
  ],
})
export class AppModule {}
