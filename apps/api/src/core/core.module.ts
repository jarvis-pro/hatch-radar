import { Global, Module, type Provider } from '@nestjs/common';
import { type AppEnv } from '@/config/env';
import { AuditLogsRepository, CommentsRepository, DeviceCredentialsRepository, DeviceEnrollmentsRepository, InsightsRepository, BlueprintsRepository, ProcessesRepository, RunsRepository, TasksRepository, TaskStagesRepository, RequestQueueRepository, RequestLanesRepository, LoginAttemptsRepository, PostsRepository, ProvidersRepository, SessionsRepository, SettingsRepository, SourceConnectorsRepository, SourcesRepository, StatsRepository, CostRepository, TranslationsRepository, UsersRepository, RuntimeSettingsService } from '@/lib/db';
import { AnalysisConfigService, TranslationService, AnalysisService } from '@/lib/analysis';
import { TokenBucketQueue, HackerNewsClient, CrawlerConfigService } from '@/lib/crawler';
import { AccountService, AdminService, DeviceAuthService, SyncService, ExportService, SourcesService, SettingsService, TranslationOrchestrator, SchedulerService, PipelineService, PipelineQueryService, RadarService, BlueprintService, ProcessService, WorkerService, CollectionExecutor, RequestGate, LocalDispatcher, SourcesSeeder, BlueprintsSeeder, ProcessesSeeder, SuperAdminSeeder, RuntimeSettingsSeeder, SeedRunner } from '@/domain';
import { APP_ENV, WORKER_CONCURRENCY } from '@/common/tokens';

/**
 * 领域核心模块（全局）。
 *
 * 方案 A 塌缩后：原框架无关能力包（kernel/db/crawler/analysis/auth）已内联到 `@/lib/*` 并全部加
 * `@Injectable()`，领域服务亦然。本模块把这些类**直接列为 provider**，由 NestJS 按构造参数类型
 * 自动注入——退役了 `createCore` 装配工厂 +「类当令牌 useFactory」桥（assembly.ts 已删）。
 *
 * 非类依赖经令牌：仓储 / 部分服务 `@Inject(PRISMA)`（DatabaseModule 全局提供）、SuperAdminSeeder
 * `@Inject(APP_ENV)`（AppConfigModule 全局提供）、LocalDispatcher `@Inject(WORKER_CONCURRENCY)`（下方派生）。
 *
 * @Global：处处可注入，各功能模块无需显式 import。生命周期（认领泵 / 调度 / 种子）由各自的 starter 触发。
 */
const CLASSES = [
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
  // 内联能力服务
  HackerNewsClient,
  CrawlerConfigService,
  AnalysisConfigService,
  TranslationService,
  AnalysisService,
  RuntimeSettingsService,
  // 领域服务
  AccountService,
  AdminService,
  DeviceAuthService,
  SyncService,
  ExportService,
  SourcesService,
  SettingsService,
  TranslationOrchestrator,
  SchedulerService,
  PipelineService,
  PipelineQueryService,
  RadarService,
  BlueprintService,
  ProcessService,
  // 内嵌执行器
  WorkerService,
  CollectionExecutor,
  LocalDispatcher,
  // 种子
  SourcesSeeder,
  BlueprintsSeeder,
  ProcessesSeeder,
  SuperAdminSeeder,
  RuntimeSettingsSeeder,
  SeedRunner,
];

const PROVIDERS: Provider[] = [
  // 内嵌执行器并发上限：从 APP_ENV 派生供 LocalDispatcher 注入
  {
    provide: WORKER_CONCURRENCY,
    useFactory: (env: AppEnv): number => env.workerConcurrency,
    inject: [APP_ENV],
  },
  // 末位构造参数是带默认值的 options（非 DI 依赖），故经工厂构造而非自动注入
  { provide: TokenBucketQueue, useFactory: (): TokenBucketQueue => new TokenBucketQueue() },
  {
    provide: RequestGate,
    useFactory: (queue: RequestQueueRepository, lanes: RequestLanesRepository): RequestGate =>
      new RequestGate(queue, lanes),
    inject: [RequestQueueRepository, RequestLanesRepository],
  },
  ...CLASSES,
];

@Global()
@Module({
  providers: PROVIDERS,
  exports: [WORKER_CONCURRENCY, TokenBucketQueue, RequestGate, ...CLASSES],
})
export class CoreModule {}
