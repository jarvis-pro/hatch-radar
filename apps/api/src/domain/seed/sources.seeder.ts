import { Injectable } from '@nestjs/common';
import { SourcesRepository } from '@/lib/db';
import type { Seeder, SeedContext, SeedOutcome } from './seeder';
import { HN_SECTIONS, RSS_FEEDS, SUBREDDITS } from './source-lists';

/**
 * 首启来源列表（幂等）：sources 表空时把代码常量写入，保证开箱即有默认监控面。
 * non-critical：来源可事后在设置页增减，播种失败不应阻断启动。order 最小：先于 scheduler 初始轮取数。
 */
@Injectable()
export class SourcesSeeder implements Seeder {
  readonly name = 'sources';
  readonly order = 10;
  readonly critical = false;

  constructor(private readonly sources: SourcesRepository) {}

  async run(ctx: SeedContext): Promise<SeedOutcome> {
    if ((await this.sources.countSources()) > 0) {
      return { status: 'skipped', reason: 'sources 表非空' };
    }
    for (const sub of SUBREDDITS) {
      await this.sources.createSource(
        {
          platform: 'reddit',
          identifier: sub,
          label: sub,
          config: { sorts: ['hot', 'new'], limit: 25 },
        },
        ctx.now,
      );
    }
    for (const hn of HN_SECTIONS) {
      await this.sources.createSource(
        { platform: 'hackernews', identifier: hn.endpoint, label: hn.channel },
        ctx.now,
      );
    }
    for (const feed of RSS_FEEDS) {
      await this.sources.createSource(
        { platform: 'rss', identifier: feed.url, label: feed.name },
        ctx.now,
      );
    }
    return {
      status: 'seeded',
      detail: `reddit ${SUBREDDITS.length} / hackernews ${HN_SECTIONS.length} / rss ${RSS_FEEDS.length}`,
    };
  }
}
