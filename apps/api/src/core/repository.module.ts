import { Global, Module } from '@nestjs/common';
import {
  AuditLogsRepository,
  BlueprintsRepository,
  CommentsRepository,
  CostRepository,
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
 * 仓储模块（全局）：全部 20 个仓储类。
 *
 * 仓储是无状态数据访问叶子——仅 `@Inject(PRISMA)`（DatabaseModule @Global 提供），彼此不依赖、
 * 不依赖任何领域服务，故 @Global 零循环风险，处处可注入。把「数据访问叶子」与「领域服务」
 * 在 module 层分离：领域服务现按限界上下文分散在各 feature module，仓储统一在此全局基座。
 */
const REPOSITORIES = [
  AuditLogsRepository,
  BlueprintsRepository,
  CommentsRepository,
  CostRepository,
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
