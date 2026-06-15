import { Global, Module, type InjectionToken, type Provider } from '@nestjs/common';
import type { AppDatabase } from '@hatch-radar/db';
import {
  AccountService,
  AdminService,
  AnalysisConfigService,
  AnalysisService,
  AuditLogsRepository,
  CommentsRepository,
  createCore,
  CrawlerConfigService,
  DataService,
  DeviceAuthService,
  DeviceCredentialsRepository,
  DeviceEnrollmentsRepository,
  ExportService,
  GatewayService,
  InsightsRepository,
  JobsRepository,
  LoginAttemptsRepository,
  PostsRepository,
  ProvidersRepository,
  RuntimeSettingsService,
  SchedulerService,
  SeedRunner,
  SessionsRepository,
  SettingsRepository,
  SourceConnectorsRepository,
  SourcesRepository,
  StatsRepository,
  SyncService,
  UsersRepository,
  WorkerService,
  type AppEnv,
  type Core,
} from '@/domain';
import { APP_ENV, CORE, PRISMA } from '@/common/tokens';

/**
 * 领域核心桥接模块（全局）。
 *
 * `apps/server`（NestJS）不再自带仓储/服务,改用 @/domain：onReady 前由 {@link CORE} 工厂
 * 调 createCore(PRISMA, APP_ENV) 一处装配全部领域实例,再把每个实例以「其类」为 DI 令牌登记
 * （NestJS 支持「类当 token + useFactory」,故控制器/守卫维持按类型构造注入,无需改注入点）。
 *
 * @Global：与原 RepositoriesModule/AnalysisModule 等价的「处处可注入」效果,各功能模块无需显式 import。
 * 领域实例共享同一个 createCore 图（单例 gateway/scheduler/worker 等）。
 */
const fromCore = <K extends keyof Core>(token: InjectionToken, key: K): Provider => ({
  provide: token,
  useFactory: (core: Core) => core[key],
  inject: [CORE],
});

const PROVIDERS: Provider[] = [
  {
    provide: CORE,
    useFactory: (db: AppDatabase, env: AppEnv): Core => createCore(db, env),
    inject: [PRISMA, APP_ENV],
  },
  // 仓储
  fromCore(AuditLogsRepository, 'auditLogs'),
  fromCore(CommentsRepository, 'comments'),
  fromCore(DeviceCredentialsRepository, 'deviceCredentials'),
  fromCore(DeviceEnrollmentsRepository, 'deviceEnrollments'),
  fromCore(InsightsRepository, 'insights'),
  fromCore(JobsRepository, 'jobs'),
  fromCore(LoginAttemptsRepository, 'loginAttempts'),
  fromCore(PostsRepository, 'posts'),
  fromCore(ProvidersRepository, 'providers'),
  fromCore(SessionsRepository, 'sessions'),
  fromCore(SettingsRepository, 'settings'),
  fromCore(SourceConnectorsRepository, 'sourceConnectors'),
  fromCore(SourcesRepository, 'sources'),
  fromCore(StatsRepository, 'stats'),
  fromCore(UsersRepository, 'users'),
  // 服务
  fromCore(AccountService, 'account'),
  fromCore(AdminService, 'admin'),
  fromCore(DataService, 'data'),
  fromCore(AnalysisConfigService, 'analysisConfig'),
  fromCore(AnalysisService, 'analysis'),
  fromCore(RuntimeSettingsService, 'runtimeSettings'),
  fromCore(CrawlerConfigService, 'crawlerConfig'),
  fromCore(SyncService, 'sync'),
  fromCore(ExportService, 'export'),
  fromCore(DeviceAuthService, 'deviceAuth'),
  // 后台（生命周期由各自的 Nest 薄封装 starter 触发）
  fromCore(GatewayService, 'gateway'),
  fromCore(SchedulerService, 'scheduler'),
  fromCore(WorkerService, 'worker'),
  fromCore(SeedRunner, 'seedRunner'),
];

@Global()
@Module({
  providers: PROVIDERS,
  exports: PROVIDERS.map((p) => (p as { provide: InjectionToken }).provide),
})
export class CoreModule {}
