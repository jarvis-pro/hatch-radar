import { Module } from '@nestjs/common';
import { AccountModule } from '@/account/account.module';
import { InsightsController } from './insights.controller';
import { PostsController } from './posts.controller';
import { StatsController } from './stats.controller';

/**
 * 只读数据模块（后端归一 P1）：洞察 / 帖子 / 评论 / 统计端点。
 * 全部挂 SessionAuthGuard（import AccountModule 取守卫）+ 能力闸；DataService 等由 CoreModule 全局提供。
 */
@Module({
  imports: [AccountModule],
  controllers: [InsightsController, PostsController, StatsController],
})
export class DataModule {}
