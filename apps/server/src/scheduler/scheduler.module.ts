import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AnalysisModule } from '@/analysis/analysis.module';
import { CrawlerModule } from '@/crawler/crawler.module';
import { RepositoriesModule } from '@/db/repositories.module';
import { SchedulerService } from './scheduler.service';

/**
 * 调度模块：注册 @nestjs/schedule 并提供 SchedulerService（爬取/评论/分析入队/归档）。
 * 仅装入主进程 AppModule；独立 worker 进程不含本模块（不重复跑定时任务）。
 */
@Module({
  imports: [ScheduleModule.forRoot(), CrawlerModule, RepositoriesModule, AnalysisModule],
  providers: [SchedulerService],
})
export class SchedulerModule {}
