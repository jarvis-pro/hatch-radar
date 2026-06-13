import { Module } from '@nestjs/common';
import { CommentsRepository } from './comments.repository';
import { InsightsRepository } from './insights.repository';
import { JobsRepository } from './jobs.repository';
import { PostsRepository } from './posts.repository';
import { ProvidersRepository } from './providers.repository';
import { SettingsRepository } from './settings.repository';
import { StatsRepository } from './stats.repository';

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
  StatsRepository,
];

@Module({
  providers: REPOSITORIES,
  exports: REPOSITORIES,
})
export class RepositoriesModule {}
