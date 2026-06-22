import { Module } from '@nestjs/common';
import { CapabilityModule } from './capability.module';
import { RepositoryModule } from './repository.module';
import {
  AnalysisConfigService,
  TranslationService,
  AnalysisService,
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
  TaskControlService,
  RadarService,
  BlueprintService,
  ProcessService,
  WorkerService,
  CollectionExecutor,
  AnalyzeExecutor,
  LocalDispatcher,
  SourcesSeeder,
  BlueprintsSeeder,
  ProcessesSeeder,
  SuperAdminSeeder,
  RuntimeSettingsSeeder,
  SeedRunner,
} from '@/domain';

/**
 * 领域核心模块（**非全局**）。
 *
 * 方案 A 塌缩后，原框架无关能力包（kernel/db/crawler/analysis/auth）已内联到 `@/lib/*` 并全部加
 * `@Injectable()`，领域服务亦然。本模块把**领域服务 / 执行器 / 种子**直接列为 provider，由 NestJS
 * 按构造参数类型自动注入。
 *
 * **DI 装配拆分**：原单一 @Global CoreModule 列全部 52 provider，现收敛 @Global 到两个基础设施叶子，
 * 让领域服务依赖在 module 层显式：
 * - 仓储（22 个，无状态数据访问叶子）→ {@link RepositoryModule}（@Global）。
 * - 无状态能力 / 运行期配置读取叶子（HackerNewsClient / CrawlerConfigService / RuntimeSettingsService）
 *   + 工厂 provider（WORKER_CONCURRENCY / TokenBucketQueue / RequestGate）→ {@link CapabilityModule}（@Global）。
 * - 本模块只留领域服务（18）+ 执行器（4）+ 种子（6），**去掉 @Global**——故凡注入领域服务的 wiring
 *   模块须显式 `imports: [CoreModule]`（见各 modules/*.module.ts）。
 *
 * 依赖方向：wiring 模块 → CoreModule → RepositoryModule / CapabilityModule（后两者只依赖 @Global 的
 * PRISMA/APP_ENV，彼此不依赖、不依赖 CoreModule），是确定无循环的 DAG。
 *
 * 非类依赖经令牌：仓储 / 部分服务 `@Inject(PRISMA)`（DatabaseModule 全局）、SuperAdminSeeder
 * `@Inject(APP_ENV)`（AppConfigModule 全局）、LocalDispatcher `@Inject(WORKER_CONCURRENCY)`（CapabilityModule）。
 */
const DOMAIN_CLASSES = [
  // 领域服务
  AnalysisConfigService,
  TranslationService,
  AnalysisService,
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
  TaskControlService,
  RadarService,
  BlueprintService,
  ProcessService,
  // 内嵌执行器
  WorkerService,
  CollectionExecutor,
  AnalyzeExecutor,
  LocalDispatcher,
  // 种子
  SourcesSeeder,
  BlueprintsSeeder,
  ProcessesSeeder,
  SuperAdminSeeder,
  RuntimeSettingsSeeder,
  SeedRunner,
];

@Module({
  imports: [RepositoryModule, CapabilityModule],
  providers: DOMAIN_CLASSES,
  exports: DOMAIN_CLASSES,
})
export class CoreModule {}
