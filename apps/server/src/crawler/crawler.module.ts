import { Module } from '@nestjs/common';
import { RepositoriesModule } from '@/db/repositories.module';
import { CrawlerConfigService } from './crawler-config.service';
import { HackerNewsClient } from './hackernews';
import { TokenBucketQueue } from './queue';

/**
 * 抓取模块：令牌桶队列 + 各来源客户端 + 采集运行期配置服务。
 * Reddit 凭据已彻底入库——CrawlerConfigService 按 DB 连接器惰性构建 Reddit 客户端
 * （RSS 用纯函数 fetchFeed，不入 DI）。来源列表也由其首启播种入库。
 */
@Module({
  imports: [RepositoriesModule],
  providers: [
    { provide: TokenBucketQueue, useFactory: () => new TokenBucketQueue() },
    { provide: HackerNewsClient, useFactory: () => new HackerNewsClient() },
    CrawlerConfigService,
  ],
  exports: [TokenBucketQueue, HackerNewsClient, CrawlerConfigService],
})
export class CrawlerModule {}
