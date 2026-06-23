import { Module, RequestMethod } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { AllExceptionsFilter } from './common/http-exception.filter';
import { AccountModule } from './modules/account/account.module';
import { AdminModule } from './modules/admin/admin.module';
import { AppConfigModule } from './config/app-config.module';
import { CapabilityModule } from './core/capability.module';
import { ExportModule } from './modules/export/export.module';
import { RepositoryModule } from './core/repository.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './modules/health/health.module';
import { logger } from './logger';
import { PipelineModule } from './modules/pipeline/pipeline.module';
import { RequestsModule } from './modules/requests/requests.module';
import { RadarModule } from './modules/radar/radar.module';
import { SchedulerModule } from './modules/scheduler/scheduler.module';
import { SeedModule } from './modules/seed/seed.module';
import { SettingsModule } from './modules/settings/settings.module';
import { SourcesModule } from './modules/sources/sources.module';
import { TranslationModule } from './modules/translation/translation.module';
import { WorkerModule } from './modules/worker/worker.module';

/**
 * 后端根模块（单进程归一：唯一进程）：聚合 HTTP 接口 + 定时调度 + 内嵌任务执行（web SPA 单独部署，api 不再同源托管）。
 *
 * 领域服务各归 feature module（与其 `*.module.ts` 同目录 collocate 在 `src/modules/<上下文>/`）；DI 按
 * **限界上下文拆 feature module**（取代原全局平铺的 CoreModule）：横切基座
 * RepositoryModule（@Global，20 仓储）+ CapabilityModule（@Global，无状态能力 / 运行期配置读取 + 工厂
 * provider）+ DatabaseModule（@Global，PRISMA 事务感知代理 + TxContext）此处注册即处处可注入；各 feature
 * module（Analysis / Worker / Pipeline / Radar / Settings / Sources / Export / Translation / Account /
 * Admin / Scheduler / Seed）各自 providers 领域服务、只 exports 公共面、按需 imports 依赖模块——依赖
 * 图为无环 DAG（Analysis←Worker←Pipeline←{Radar / Settings / Translation / Scheduler}）。各 feature module
 * 同时声明自己的 HTTP 控制器（与 service 同目录 collocate）；根模块在此组合全部 feature module。
 * imports 各模块职责：
 * - AccountModule  会话鉴权权威（SessionAuthGuard 经 APP_GUARD 全局挂载 + cookie）+ 账户端点。
 * - AdminModule    后台管理 + 审计日志（admin / audit）。
 * - PipelineModule / RadarModule / SettingsModule / SourcesModule / TranslationModule / ExportModule
 *                  各上下文的领域服务 + 其 HTTP 控制器。
 * - DashboardModule / RequestsModule / HealthModule  各自独立的单控制器边缘模块
 *                  （看板 / 出站请求闸视图 / 健康检查）——已无 http 杂物聚合模块。
 * - WorkerModule   内嵌执行器生命周期（WorkerStarter）：起认领泵 + 僵死回收，关停排空在途任务。
 * - SchedulerModule  @Cron 采集/复查/分析/归档触发（执行经 LocalDispatcher 同进程认领）。
 * - SeedModule     首启播种，须排在 SchedulerModule 之前（先播种再跑初始轮）。
 *
 * 任务执行（原独立 apps/worker 进程）已并入本进程：PipelineService 入队后经 LocalDispatcher
 * 在同进程内直接认领并交 WorkerService 执行（无 WS、无序列化）。
 */
@Module({
  imports: [
    // forRoutes 显式用 path-to-regexp v8（Express 5 / Nest 11）命名通配 `{*path}`：
    // 库默认 `{ path: '*' }` 叠加全局前缀 `api` → `/api/*`，是旧式通配，Nest 每个中间件
    // 转一次（pino 注册两个 → 两条 LegacyRouteConverter 警告）。写成 `{*path}` 后叠加前缀
    // 直接得合法的 `/api/{*path}`，无需转换、无警告；语义不变（覆盖全部 /api 路由）。
    LoggerModule.forRoot({
      pinoHttp: { logger, autoLogging: false },
      forRoutes: [{ path: '{*path}', method: RequestMethod.ALL }],
    }),
    AppConfigModule,
    DatabaseModule,
    RepositoryModule,
    CapabilityModule,
    AccountModule,
    AdminModule,
    PipelineModule,
    RadarModule,
    SettingsModule,
    SourcesModule,
    TranslationModule,
    ExportModule,
    DashboardModule,
    RequestsModule,
    HealthModule,
    SeedModule,
    WorkerModule,
    SchedulerModule,
  ],
  // 全局异常过滤器经 DI 装配（取代 main.ts 的 new AllExceptionsFilter()）：可注入、可在测试中替换。
  providers: [{ provide: APP_FILTER, useClass: AllExceptionsFilter }],
})
export class AppModule {}
