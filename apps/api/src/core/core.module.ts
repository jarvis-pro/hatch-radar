import { Module } from '@nestjs/common';
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
 * 框架无关能力代码 + 领域服务全部加 `@Injectable()`（方案 A 塌缩把能力包并入 api、后续 `lib/` 解散，
 * 能力散入 `@/database` / `@/crawler` / `@/analysis` / `@/auth` / `@/utils` 等 src 根目录）。本模块把
 * **领域服务 / 执行器 / 种子**直接列为 provider，由 NestJS 按构造参数类型自动注入。
 *
 * **DI 装配拆分**：原单一 @Global CoreModule 列全部 52 provider，现按职责拆三层、收敛 @Global 到两个
 * 基础设施叶子：
 * - 仓储（22 个，无状态数据访问叶子）→ `RepositoryModule`（@Global）。
 * - 无状态能力 / 运行期配置读取叶子（HackerNewsClient / CrawlerConfigService / RuntimeSettingsService）
 *   + 工厂 provider（WORKER_CONCURRENCY / TokenBucketQueue / RequestGate）→ `CapabilityModule`（@Global）。
 * - 本模块只留领域服务（18）+ 执行器（4）+ 种子（6），**去掉 @Global**——故凡注入领域服务的 wiring
 *   模块须显式 `imports: [CoreModule]`（见各 modules/*.module.ts）。
 *
 * 逻辑依赖方向：wiring 模块 → CoreModule → 仓储 / 能力叶子，是确定无循环的 DAG。但后两层是 @Global，
 * 已在 AppModule 注册一次即全局可注入，故本模块**不显式 `imports` 它们**——那是冗余的：全局 exports 经
 * 全局 injector 注册表解析，与是否 import 无关。三者各在 AppModule 顶层注册一次即可。
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
  providers: DOMAIN_CLASSES,
  exports: DOMAIN_CLASSES,
})
export class CoreModule {}
