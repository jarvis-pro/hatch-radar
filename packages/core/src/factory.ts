import type { AppDatabase } from '@hatch-radar/db';
import type { AppEnv } from '@hatch-radar/kernel';
// repos
import { AuditLogsRepository } from '@hatch-radar/db';
import { CommentsRepository } from '@hatch-radar/db';
import { DeviceCredentialsRepository } from '@hatch-radar/db';
import { DeviceEnrollmentsRepository } from '@hatch-radar/db';
import { InsightsRepository } from '@hatch-radar/db';
import { JobsRepository } from '@hatch-radar/db';
import { LoginAttemptsRepository } from '@hatch-radar/db';
import { PostsRepository } from '@hatch-radar/db';
import { ProvidersRepository } from '@hatch-radar/db';
import { SessionsRepository } from '@hatch-radar/db';
import { SettingsRepository } from '@hatch-radar/db';
import { SourceConnectorsRepository } from '@hatch-radar/db';
import { SourcesRepository } from '@hatch-radar/db';
import { StatsRepository } from '@hatch-radar/db';
import { UsersRepository } from '@hatch-radar/db';
// infra singletons
import { TokenBucketQueue } from '@hatch-radar/crawler';
import { HackerNewsClient } from '@hatch-radar/crawler';
// services
import { RuntimeSettingsService } from '@hatch-radar/db';
import { CrawlerConfigService } from '@hatch-radar/crawler';
import { AnalysisService } from './analysis/analysis.service';
import { AnalysisConfigService } from './analysis/analysis-config.service';
import { GatewayService } from './gateway/gateway.service';
import { DataService } from './data/data.service';
import { AccountService } from './account/account.service';
import { AdminService } from './admin/admin.service';
import { DeviceAuthService } from './auth/device-auth.service';
import { SyncService } from './sync/sync.service';
import { ExportService } from './export/export.service';
import { SchedulerService } from './scheduler/scheduler.service';
import { WorkerService } from './worker/worker.service';
// seed
import { SourcesSeeder } from './seed/sources.seeder';
import { SuperAdminSeeder } from './seed/super-admin.seeder';
import { RuntimeSettingsSeeder } from './seed/runtime-settings.seeder';
import { SeedRunner } from './seed/seed.runner';

/**
 * 领域装配工厂：一处把全部仓储 / 服务 / 调度 / 网关 / worker / 种子按依赖图实例化好。
 *
 * 框架无关——api 与 worker 两端都调它拿到同一套领域实例，再用框架的 IoC 把需要的实例登记进
 * 容器（NestJS：以 value provider 按令牌登记）。依赖图只在此定义一次。
 *
 * gateway 始终创建但只在 api 侧 `start(server)` 后才真正开 WS；AnalysisConfigService 以它作派发器
 * （worker 侧不入队，故不触发派发）。
 */
export function createCore(db: AppDatabase, env: AppEnv) {
  // ── 仓储（仅依赖 db）──────────────────────────────────────────────────
  const auditLogs = new AuditLogsRepository(db);
  const comments = new CommentsRepository(db);
  const deviceCredentials = new DeviceCredentialsRepository(db);
  const deviceEnrollments = new DeviceEnrollmentsRepository(db);
  const insights = new InsightsRepository(db);
  const jobs = new JobsRepository(db);
  const loginAttempts = new LoginAttemptsRepository(db);
  const posts = new PostsRepository(db);
  const providers = new ProvidersRepository(db);
  const sessions = new SessionsRepository(db);
  const settings = new SettingsRepository(db);
  const sourceConnectors = new SourceConnectorsRepository(db);
  const sources = new SourcesRepository(db);
  const stats = new StatsRepository(db);
  const users = new UsersRepository(db);

  // ── 基础设施单例 ─────────────────────────────────────────────────────
  const queue = new TokenBucketQueue();
  const hackernews = new HackerNewsClient();

  // ── 服务 ─────────────────────────────────────────────────────────────
  const runtimeSettings = new RuntimeSettingsService(settings);
  const crawlerConfig = new CrawlerConfigService(sourceConnectors, queue);
  const analysis = new AnalysisService(insights);
  const gateway = new GatewayService(jobs);
  const analysisConfig = new AnalysisConfigService(providers, settings, jobs, posts, gateway);
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
    analysisConfig,
    runtimeSettings,
  );
  const worker = new WorkerService(jobs, posts, comments, analysis, analysisConfig, runtimeSettings);

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
    loginAttempts,
    posts,
    providers,
    sessions,
    settings,
    sourceConnectors,
    sources,
    stats,
    users,
    queue,
    hackernews,
    runtimeSettings,
    crawlerConfig,
    analysis,
    gateway,
    analysisConfig,
    data,
    account,
    admin,
    deviceAuth,
    sync,
    export: exportService,
    scheduler,
    worker,
    sourcesSeeder,
    superAdminSeeder,
    runtimeSettingsSeeder,
    seedRunner,
  };
}

/** createCore 返回的全套领域实例类型。 */
export type Core = ReturnType<typeof createCore>;
