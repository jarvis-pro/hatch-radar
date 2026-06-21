import { Module } from '@nestjs/common';
import { AccountModule } from '@/account/account.module';
import { DashboardController } from './dashboard.controller';
import { PostsController } from './posts.controller';

/**
 * 只读数据模块：看板聚合（/dashboard）+ 工作台待分析清单（/posts/awaiting）。
 * 洞察 / 帖子浏览与详情已统一到 RadarController（/api/radar/*）；旧 insights/posts(list)/stats 端点已退役。
 * 挂 SessionAuthGuard（import AccountModule 取守卫）+ 能力闸；DataService 由 CoreModule 全局提供。
 */
@Module({
  imports: [AccountModule],
  controllers: [PostsController, DashboardController],
})
export class DataModule {}
