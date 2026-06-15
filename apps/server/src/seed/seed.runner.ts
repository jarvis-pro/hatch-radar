import { Inject, Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { nowSec } from '@/utils/time';
import { logger } from '@/logger';
import { SEEDERS, type Seeder, type SeedContext } from './seeder';

/**
 * 种子编排器：启动时按 order 串行驱动全部 Seeder（唯一入口）。
 * - 统一时间（一次 nowSec 下传）、统一日志、统一失败语义
 * - critical 失败 → 向上抛中止启动；non-critical 失败 → warn 后继续
 *
 * 触发于 OnApplicationBootstrap；靠 app.module imports 顺序保证早于 SchedulerModule 初始轮
 * （即便顺序被破坏，scan() 本就容忍空 sources、下一轮 cron 自愈，非正确性问题）。
 */
@Injectable()
export class SeedRunner implements OnApplicationBootstrap {
  constructor(@Inject(SEEDERS) private readonly seeders: readonly Seeder[]) {}

  async onApplicationBootstrap(): Promise<void> {
    const ctx: SeedContext = { now: nowSec() };
    const ordered = [...this.seeders].sort((a, b) => a.order - b.order);
    for (const seeder of ordered) {
      try {
        const outcome = await seeder.run(ctx);
        if (outcome.status === 'seeded') {
          logger.info(`[seed] ${seeder.name}：${outcome.detail}`);
        } else {
          logger.debug(`[seed] ${seeder.name} 跳过：${outcome.reason}`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (seeder.critical) {
          logger.error(`[seed] ${seeder.name} 失败（critical），中止启动：${msg}`);
          throw err;
        }
        logger.warn(`[seed] ${seeder.name} 失败（non-critical），已跳过：${msg}`);
      }
    }
  }
}
