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
 * 控制面根模块（单实例）：聚合 HTTP 接口 + 定时调度 + push 网关 + 同源托管 web SPA。
 *
 * 领域逻辑全在 @/domain：CoreModule（@Global）用 createCore 一处装配、按类登记,处处可按类型注入；
 * 各功能模块只留控制器/守卫与生命周期薄封装。imports 各模块职责：
 * - AccountModule  会话鉴权权威（SessionAuthGuard + cookie），web/mobile 共用。
 * - DataModule     只读展示：dashboard / insights / posts / stats。
 * - AdminModule    后台管理 + 审计日志（admin / audit）。
 * - HttpModule     业务写/操作面：export / sync / settings / analysis / pipeline（检视器）
 *                  / requests（出站请求闸）/ translations / sources / me / health。
 * - GatewayModule  WS push 网关，worker 经此认领任务。
 * - SchedulerModule  @Cron 采集/复查/分析/归档触发（执行下沉 worker）。
 * - SeedModule     首启播种，须排在 SchedulerModule 之前（先播种再跑初始轮）。
 * - StaticModule   同源托管 web SPA。
 *
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
