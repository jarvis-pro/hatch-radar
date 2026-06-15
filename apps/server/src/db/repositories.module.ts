import { Module } from '@nestjs/common';
import { AuditLogsRepository } from './audit-logs.repository';
import { CommentsRepository } from './comments.repository';
import { DeviceCredentialsRepository } from './device-credentials.repository';
import { DeviceEnrollmentsRepository } from './device-enrollments.repository';
import { InsightsRepository } from './insights.repository';
import { JobsRepository } from './jobs.repository';
import { LoginAttemptsRepository } from './login-attempts.repository';
import { PostsRepository } from './posts.repository';
import { ProvidersRepository } from './providers.repository';
import { SessionsRepository } from './sessions.repository';
import { SettingsRepository } from './settings.repository';
import { SourceConnectorsRepository } from './source-connectors.repository';
import { SourcesRepository } from './sources.repository';
import { StatsRepository } from './stats.repository';
import { UsersRepository } from './users.repository';

/**
 * 仓储模块：聚合全部 Prisma repository（注入 PRISMA，由全局 DatabaseModule 提供）。
 * 各功能模块 import 本模块即可注入所需 repository。
 */
const REPOSITORIES = [
  PostsRepository,
  CommentsRepository,
  InsightsRepository,
  JobsRepository,
  ProvidersRepository,
  SettingsRepository,
  SourcesRepository,
  SourceConnectorsRepository,
  StatsRepository,
  // 账户 / 会话 / 审计 / 设备（后端归一：人鉴权与管理收进 server）
  UsersRepository,
  SessionsRepository,
  LoginAttemptsRepository,
  AuditLogsRepository,
  DeviceCredentialsRepository,
  DeviceEnrollmentsRepository,
];

@Module({
  providers: REPOSITORIES,
  exports: REPOSITORIES,
})
export class RepositoriesModule {}
