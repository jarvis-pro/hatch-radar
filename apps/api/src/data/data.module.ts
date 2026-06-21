import { Module } from '@nestjs/common';
import { AccountModule } from '@/account/account.module';
import { DashboardController } from './dashboard.controller';

/**
 * 只读数据模块：看板聚合（/dashboard）。
 * 洞察 / 帖子浏览与详情已统一到 RadarController（/api/radar/*）；旧 insights/posts/stats 端点与「发起分析」已退役。
 * 挂 SessionAuthGuard（import AccountModule 取守卫）+ 能力闸；DataService 由 CoreModule 全局提供。
 */
@Module({
  imports: [AccountModule],
  controllers: [DashboardController],
})
export class DataModule {}
