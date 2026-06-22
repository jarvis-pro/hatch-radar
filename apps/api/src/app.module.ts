import { Module, RequestMethod } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { AllExceptionsFilter } from './common/http-exception.filter';
import { AccountModule } from './modules/account/account.module';
import { AdminModule } from './modules/admin/admin.module';
import { AppConfigModule } from './config/app-config.module';
import { CapabilityModule } from './core/capability.module';
import { RepositoryModule } from './core/repository.module';
import { DatabaseModule } from './database/database.module';
import { HttpModule } from './modules/http/http.module';
import { logger } from './logger';
import { SchedulerModule } from './modules/scheduler/scheduler.module';
import { SeedModule } from './modules/seed/seed.module';
import { WorkerModule } from './modules/worker/worker.module';

/**
 * 后端根模块（单进程归一：唯一进程）：聚合 HTTP 接口 + 定时调度 + 内嵌任务执行（web SPA 单独部署，api 不再同源托管）。
 *
 * 领域逻辑全在 @/domain；DI 按**限界上下文拆 feature module**（取代原全局平铺的 CoreModule）：横切基座
 * RepositoryModule（@Global，22 仓储）+ CapabilityModule（@Global，无状态能力 / 运行期配置读取 + 工厂
 * provider）+ DatabaseModule（@Global，PRISMA 事务感知代理 + TxContext）此处注册即处处可注入；各 feature
 * module（Analysis / Worker / Pipeline / Radar / Settings / Sources / Sync / Export / Translation / Account /
 * Auth / Admin / Scheduler / Seed）各自 providers 领域服务、只 exports 公共面、按需 imports 依赖模块——依赖
 * 图为无环 DAG（Analysis←Worker←Pipeline←{Radar / Settings / Translation / Scheduler}），HttpModule 按其
 * 控制器所需 import 对应 feature module。
 * imports 各模块职责：
 * - AccountModule  会话鉴权权威（SessionAuthGuard + cookie），web/mobile 共用。
 * - AdminModule    后台管理 + 审计日志（admin / audit）。
 * - HttpModule     会话守卫下的业务控制器统一收口：dashboard / export / sync / settings / analysis
 *                  / pipeline（检视器）/ requests（出站请求闸）/ translations / sources / me / health。
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
    SeedModule,
    AdminModule,
    WorkerModule,
    HttpModule,
    SchedulerModule,
  ],
  // 全局异常过滤器经 DI 装配（取代 main.ts 的 new AllExceptionsFilter()）：可注入、可在测试中替换。
  providers: [{ provide: APP_FILTER, useClass: AllExceptionsFilter }],
})
export class AppModule {}
