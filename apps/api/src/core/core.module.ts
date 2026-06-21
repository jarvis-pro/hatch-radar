import { Global, Module, type InjectionToken, type Provider, type Type } from '@nestjs/common';
import type { AppDatabase } from '@/lib/db';
import {
  AccountService,
  AdminService,
  AnalysisConfigService,
  AuditLogsRepository,
  CommentsRepository,
  createCore,
  CrawlerConfigService,
  DataService,
  DeviceAuthService,
  DeviceCredentialsRepository,
  DeviceEnrollmentsRepository,
  ExportService,
  LocalDispatcher,
  WorkerService,
  InsightsRepository,
  BlueprintsRepository,
  ProcessesRepository,
  RunsRepository,
  TasksRepository,
  TaskStagesRepository,
  LoginAttemptsRepository,
  PipelineService,
  RadarService,
  PostsRepository,
  ProvidersRepository,
  RequestQueueRepository,
  RequestLanesRepository,
  RuntimeSettingsService,
  SchedulerService,
  SeedRunner,
  SessionsRepository,
  SettingsRepository,
  SourceConnectorsRepository,
  SourcesRepository,
  StatsRepository,
  CostRepository,
  SyncService,
  TranslationService,
  TranslationsRepository,
  UsersRepository,
  type AppEnv,
  type Core,
} from '@/domain';
import { APP_ENV, CORE, PRISMA } from '@/common/tokens';

/**
 * 领域核心桥接模块（全局）。
 *
 * `apps/api`（NestJS）不自带仓储/服务,改用 @/domain：boot 前由 {@link CORE} 工厂调
 * createCore(PRISMA, APP_ENV) 一处装配全部领域实例;{@link exposeCore} 再把需暴露的类以「其类」
 * 为 DI 令牌登记——运行时按 constructor 从 Core 图精确取出对应实例（同类仅一份），故控制器/守卫
 * 维持按类型构造注入,无需改注入点。**assembly 是依赖图的唯一真源**,这里只列「要暴露给 DI 的类」,
 * 不再维护与其返回键同步的字符串键。
 *
 * @Global：与原 RepositoriesModule/AnalysisModule 等价的「处处可注入」效果,各功能模块无需显式 import。
 * 领域实例共享同一个 createCore 图（单例 worker/localDispatcher/scheduler 等）；单进程归一后任务执行内嵌本进程。
 */

/**
 * 把 createCore 产出的实例按其类登记为 Nest provider：运行时从 Core 图按 constructor 精确匹配取出
 * （取代逐条 `fromCore(Class, 'key')`——去掉与 assembly 返回键重复的字符串键）。暴露了 createCore
 * 未产出的类时 boot 即抛错（fail-fast，CoreModule 加载即触发，测试 / 启动冒烟必经）。
 */
function exposeCore(...tokens: Type<unknown>[]): Provider[] {
  return tokens.map((token) => ({
    provide: token,
    inject: [CORE],
    useFactory: (core: Core): object => {
      const found = (Object.values(core) as object[]).find(
        (v) => (v.constructor as unknown) === token,
      );
      if (!found)
        throw new Error(`CoreModule: createCore 未产出 ${token.name} 实例,无法按其类登记`);
      return found;
    },
  }));
}

const PROVIDERS: Provider[] = [
  {
    provide: CORE,
    useFactory: (db: AppDatabase, env: AppEnv): Core => createCore(db, env),
    inject: [PRISMA, APP_ENV],
  },
  ...exposeCore(
    // 仓储
    AuditLogsRepository,
    CommentsRepository,
    DeviceCredentialsRepository,
    DeviceEnrollmentsRepository,
    InsightsRepository,
    BlueprintsRepository,
    ProcessesRepository,
    RunsRepository,
    TasksRepository,
    TaskStagesRepository,
    RequestQueueRepository,
    RequestLanesRepository,
    LoginAttemptsRepository,
    PostsRepository,
    ProvidersRepository,
    SessionsRepository,
    SettingsRepository,
    SourceConnectorsRepository,
    SourcesRepository,
    StatsRepository,
    CostRepository,
    TranslationsRepository,
    UsersRepository,
    // 服务
    AccountService,
    AdminService,
    DataService,
    AnalysisConfigService,
    TranslationService,
    RuntimeSettingsService,
    CrawlerConfigService,
    SyncService,
    ExportService,
    DeviceAuthService,
    // 后台（生命周期由各自的 Nest 薄封装 starter 触发）
    WorkerService,
    LocalDispatcher,
    PipelineService,
    RadarService,
    SchedulerService,
    SeedRunner,
  ),
];

@Global()
@Module({
  providers: PROVIDERS,
  exports: PROVIDERS.map((p) => (p as { provide: InjectionToken }).provide),
})
export class CoreModule {}
