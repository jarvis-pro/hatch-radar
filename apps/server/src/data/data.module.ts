import { Module } from '@nestjs/common';
import { AccountModule } from '@/account/account.module';
import { RepositoriesModule } from '@/db/repositories.module';
import { DataService } from './data.service';
import { InsightsController } from './insights.controller';
import { PostsController } from './posts.controller';
import { StatsController } from './stats.controller';

/**
 * 只读数据模块（后端归一 P1）：洞察 / 帖子 / 评论 / 统计端点。
 * 全部挂 SessionAuthGuard + 能力闸（insights:view / posts:view / analyze:run）。
 */
@Module({
  imports: [RepositoriesModule, AccountModule],
  controllers: [InsightsController, PostsController, StatsController],
  providers: [DataService],
})
export class DataModule {}
