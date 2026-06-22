import { Global, Module } from '@nestjs/common';
import {
  AuditLogsRepository,
  BlueprintsRepository,
  CommentsRepository,
  CostRepository,
  DeviceCredentialsRepository,
  DeviceEnrollmentsRepository,
  InsightsRepository,
  LoginAttemptsRepository,
  PostsRepository,
  ProcessesRepository,
  ProvidersRepository,
  RequestLanesRepository,
  RequestQueueRepository,
  RunsRepository,
  SessionsRepository,
  SettingsRepository,
  SourceConnectorsRepository,
  SourcesRepository,
  StatsRepository,
  TasksRepository,
  TaskStagesRepository,
  TranslationsRepository,
  UsersRepository,
} from '@/database';

/**
 * 仓储模块（全局）：全部 22 个仓储类。
 *
 * 仓储是无状态数据访问叶子——仅 `@Inject(PRISMA)`（DatabaseModule @Global 提供），彼此不依赖、
 * 不依赖任何领域服务，故 @Global 零循环风险，处处可注入。从原单一 CoreModule 拆出，
 * 把「数据访问叶子」与「领域服务」在 module 层分离。
 */
const REPOSITORIES = [
  AuditLogsRepository,
  BlueprintsRepository,
  CommentsRepository,
  CostRepository,
  DeviceCredentialsRepository,
  DeviceEnrollmentsRepository,
  InsightsRepository,
  LoginAttemptsRepository,
  PostsRepository,
  ProcessesRepository,
  ProvidersRepository,
  RequestLanesRepository,
  RequestQueueRepository,
  RunsRepository,
  SessionsRepository,
  SettingsRepository,
  SourceConnectorsRepository,
  SourcesRepository,
  StatsRepository,
  TasksRepository,
  TaskStagesRepository,
  TranslationsRepository,
  UsersRepository,
];

@Global()
@Module({
  providers: REPOSITORIES,
  exports: REPOSITORIES,
})
export class RepositoryModule {}
