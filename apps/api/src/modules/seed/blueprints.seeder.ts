import { Injectable } from '@nestjs/common';
import { BlueprintsRepository } from '@/database';
import type { Seeder, SeedContext, SeedOutcome } from './seeder';
import { HN_SECTIONS, RSS_FEEDS, SUBREDDITS } from './source-lists';

/** 默认采集图纸参数（首启种子；运行期可在图纸定义端调整）。 */
const COLLECT_PARAMS = { limit: 100, stopAfterKnown: 5, commentBudget: 200 };
/** 默认复查图纸参数。 */
const RECHECK_PARAMS = { batchSize: 50, batchIntervalSec: 90, backoffCap: 16 };

/**
 * 首启图纸（幂等）：blueprints 表空时建一张采集图纸 + 一张复查图纸（**纯配方、无触发节奏**）。
 * 触发节奏由 {@link ProcessesSeeder} 建的进程承载。non-critical：图纸可事后在定义端增改。order 15（晚于 sources、早于 processes）。
 */
@Injectable()
export class BlueprintsSeeder implements Seeder {
  readonly name = 'blueprints';
  readonly order = 15;
  readonly critical = false;

  constructor(private readonly blueprints: BlueprintsRepository) {}

  async run(ctx: SeedContext): Promise<SeedOutcome> {
    if ((await this.blueprints.listBlueprints()).length > 0) {
      return { status: 'skipped', reason: 'blueprints 表非空' };
    }

    const collectSources = [
      { kind: 'reddit', channels: SUBREDDITS },
      { kind: 'hackernews', channels: HN_SECTIONS.map((h) => h.channel) },
      { kind: 'rss', channels: RSS_FEEDS.map((f) => f.name) },
    ];
    await this.blueprints.createBlueprint(
      { kind: 'collect', label: '默认采集', sources: collectSources, params: COLLECT_PARAMS },
      ctx.now,
    );
    // 复查只查有评论的来源（reddit / hackernews）——rss 无评论，不在复查范围
    await this.blueprints.createBlueprint(
      {
        kind: 'recheck',
        label: '默认复查',
        sources: collectSources.filter((s) => s.kind !== 'rss'),
        params: RECHECK_PARAMS,
      },
      ctx.now,
    );

    return { status: 'seeded', detail: '采集 + 复查 各 1 张默认图纸' };
  }
}
