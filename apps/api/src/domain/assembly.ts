import type { AppDatabase } from '@hatch-radar/db';
import type { AppEnv } from '@/config/env';
// repos
import { AuditLogsRepository } from '@hatch-radar/db';
import { CommentsRepository } from '@hatch-radar/db';
import { DeviceCredentialsRepository } from '@hatch-radar/db';
import { DeviceEnrollmentsRepository } from '@hatch-radar/db';
import { InsightsRepository } from '@hatch-radar/db';
import { JobsRepository } from '@hatch-radar/db';
import { JobStepsRepository } from '@hatch-radar/db';
import { BlueprintsRepository } from '@hatch-radar/db';
import { RunsRepository } from '@hatch-radar/db';
import { TasksRepository } from '@hatch-radar/db';
import { TaskStagesRepository } from '@hatch-radar/db';
import { RequestQueueRepository } from '@hatch-radar/db';
import { RequestLanesRepository } from '@hatch-radar/db';
import { LoginAttemptsRepository } from '@hatch-radar/db';
import { PostsRepository } from '@hatch-radar/db';
import { ProvidersRepository } from '@hatch-radar/db';
import { SessionsRepository } from '@hatch-radar/db';
import { SettingsRepository } from '@hatch-radar/db';
import { SourceConnectorsRepository } from '@hatch-radar/db';
import { SourcesRepository } from '@hatch-radar/db';
import { StatsRepository } from '@hatch-radar/db';
import { TranslationsRepository } from '@hatch-radar/db';
import { UsersRepository } from '@hatch-radar/db';
// infra singletons
import { TokenBucketQueue } from '@hatch-radar/crawler';
import { HackerNewsClient } from '@hatch-radar/crawler';
// services
import { RuntimeSettingsService } from '@hatch-radar/db';
import { CrawlerConfigService } from '@hatch-radar/crawler';
import { AnalysisConfigService } from '@hatch-radar/analysis';
import { TranslationService } from '@hatch-radar/analysis';
import { GatewayService } from './gateway/gateway.service';
import { PipelineService } from './pipeline/pipeline.service';
import { DataService } from './data/data.service';
import { AccountService } from './account/account.service';
import { AdminService } from './admin/admin.service';
import { DeviceAuthService } from './auth/device-auth.service';
import { SyncService } from './sync/sync.service';
import { ExportService } from './export/export.service';
import { SchedulerService } from './scheduler/scheduler.service';
// seed
import { SourcesSeeder } from './seed/sources.seeder';
import { SuperAdminSeeder } from './seed/super-admin.seeder';
import { RuntimeSettingsSeeder } from './seed/runtime-settings.seeder';
import { SeedRunner } from './seed/seed.runner';

/**
 * api 控制面领域装配工厂：一处把仓储 / 服务 / 调度 / 网关 / 种子按依赖图实例化好。
 *
 * 用框架的 IoC 把需要的实例登记进容器（NestJS：以 value provider 按令牌登记）。依赖图只在此定义一次。
 * 不含 worker 执行（数据面在 apps/worker，自带 createWorkerCore 装配）；AnalysisConfigService 以
 * GatewayService 作派发器，把认领到的 job 经 WS push 给 worker。
 */
export function createCore(db: AppDatabase, env: AppEnv) {
  // ── 仓储（仅依赖 db）──────────────────────────────────────────────────
  const auditLogs = new AuditLogsRepository(db);
  const comments = new CommentsRepository(db);
  const deviceCredentials = new DeviceCredentialsRepository(db);
  const deviceEnrollments = new DeviceEnrollmentsRepository(db);
  const insights = new InsightsRepository(db);
  const jobs = new JobsRepository(db);
  const jobSteps = new JobStepsRepository(db);
  // 图纸驱动生命周期仓储（新执行模型；过渡期与 jobs / jobSteps 并存）
  const blueprints = new BlueprintsRepository(db);
  const runs = new RunsRepository(db);
  const tasks = new TasksRepository(db);
  const taskStages = new TaskStagesRepository(db);
  const requestQueue = new RequestQueueRepository(db);
  const requestLanes = new RequestLanesRepository(db);
  const loginAttempts = new LoginAttemptsRepository(db);
  const posts = new PostsRepository(db);
  const providers = new ProvidersRepository(db);
  const sessions = new SessionsRepository(db);
  const settings = new SettingsRepository(db);
  const sourceConnectors = new SourceConnectorsRepository(db);
  const sources = new SourcesRepository(db);
  const stats = new StatsRepository(db);
  const translations = new TranslationsRepository(db);
  const users = new UsersRepository(db);

  // ── 基础设施单例 ─────────────────────────────────────────────────────
  const queue = new TokenBucketQueue();
  const hackernews = new HackerNewsClient();

  // ── 服务 ─────────────────────────────────────────────────────────────
  const runtimeSettings = new RuntimeSettingsService(settings);
  const crawlerConfig = new CrawlerConfigService(sourceConnectors, queue);
  const gateway = new GatewayService(jobs, tasks, runtimeSettings);
  const analysisConfig = new AnalysisConfigService(
    providers,
    settings,
    jobs,
    jobSteps,
    posts,
    gateway,
  );
  const translation = new TranslationService(translations, providers);
  // 图纸执行编排：自动分析改由它派生 analyze 任务（归属 run/blueprint）
  const pipeline = new PipelineService(
    blueprints,
    runs,
    tasks,
    posts,
    analysisConfig,
    runtimeSettings,
    gateway,
  );
  const data = new DataService(db);
  const account = new AccountService(users, sessions, loginAttempts, auditLogs, runtimeSettings);
  const admin = new AdminService(users, sessions, deviceCredentials, deviceEnrollments, auditLogs);
  const deviceAuth = new DeviceAuthService(db);
  const sync = new SyncService(db);
  const exportService = new ExportService(db);
  const scheduler = new SchedulerService(
    crawlerConfig,
    hackernews,
    sources,
    posts,
    comments,
    jobs,
    pipeline,
  );

  // ── 种子 ─────────────────────────────────────────────────────────────
  const sourcesSeeder = new SourcesSeeder(sources);
  const superAdminSeeder = new SuperAdminSeeder(env, users);
  const runtimeSettingsSeeder = new RuntimeSettingsSeeder(runtimeSettings);
  const seedRunner = new SeedRunner(sourcesSeeder, superAdminSeeder, runtimeSettingsSeeder);

  return {
    auditLogs,
    comments,
    deviceCredentials,
    deviceEnrollments,
    insights,
    jobs,
    jobSteps,
    blueprints,
    runs,
    tasks,
    taskStages,
    requestQueue,
    requestLanes,
    loginAttempts,
    posts,
    providers,
    sessions,
    settings,
    sourceConnectors,
    sources,
    stats,
    translations,
    users,
    queue,
    hackernews,
    runtimeSettings,
    crawlerConfig,
    gateway,
    analysisConfig,
    translation,
    pipeline,
    data,
    account,
    admin,
    deviceAuth,
    sync,
    export: exportService,
    scheduler,
    sourcesSeeder,
    superAdminSeeder,
    runtimeSettingsSeeder,
    seedRunner,
  };
}

/** createCore 返回的全套领域实例类型。 */
export type Core = ReturnType<typeof createCore>;
