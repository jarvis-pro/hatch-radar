import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { AccountModule } from './account/account.module';
import { AdminModule } from './admin/admin.module';
import { AppConfigModule } from './config/app-config.module';
import { CoreModule } from './core/core.module';
import { DataModule } from './data/data.module';
import { DatabaseModule } from './database/database.module';
import { HttpModule } from './http/http.module';
import { logger } from './logger';
import { SchedulerModule } from './scheduler/scheduler.module';
import { SeedModule } from './seed/seed.module';
import { StaticModule } from './static/static.module';
import { WorkerModule } from './worker/worker.module';

/**
 * 后端根模块（单进程归一：唯一进程）：聚合 HTTP 接口 + 定时调度 + 内嵌任务执行 + 同源托管 web SPA。
 *
 * 领域逻辑全在 @/domain：CoreModule（@Global）用 createCore 一处装配、按类登记,处处可按类型注入；
 * 各功能模块只留控制器/守卫与生命周期薄封装。imports 各模块职责：
 * - AccountModule  会话鉴权权威（SessionAuthGuard + cookie），web/mobile 共用。
 * - DataModule     只读展示：dashboard / insights / posts / stats。
 * - AdminModule    后台管理 + 审计日志（admin / audit）。
 * - HttpModule     业务写/操作面：export / sync / settings / analysis / pipeline（检视器）
 *                  / requests（出站请求闸）/ translations / sources / me / health。
 * - WorkerModule   内嵌执行器生命周期（WorkerStarter）：起认领泵 + 僵死回收，关停排空在途任务。
 * - SchedulerModule  @Cron 采集/复查/分析/归档触发（执行经 LocalDispatcher 同进程认领）。
 * - SeedModule     首启播种，须排在 SchedulerModule 之前（先播种再跑初始轮）。
 * - StaticModule   同源托管 web SPA。
 *
 * 任务执行（原独立 apps/worker 进程）已并入本进程：PipelineService 入队后经 LocalDispatcher
 * 在同进程内直接认领并交 WorkerService 执行（无 WS、无序列化）。
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
    WorkerModule,
    HttpModule,
    SchedulerModule,
    StaticModule.forRoot(),
  ],
})
export class AppModule {}
