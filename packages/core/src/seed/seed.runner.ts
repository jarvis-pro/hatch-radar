import { logger } from '../logger';
import { RuntimeSettingsSeeder } from './runtime-settings.seeder';
import type { Seeder, SeedContext } from './seeder';
import { SourcesSeeder } from './sources.seeder';
import { SuperAdminSeeder } from './super-admin.seeder';

/**
 * 种子编排器（与 NestJS 版等价）：启动时按 order 串行驱动全部 Seeder（唯一入口）。
 * - 统一时间（一次 nowSec 下传）、统一日志、统一失败语义
 * - critical 失败 → 向上抛中止启动；non-critical 失败 → warn 后继续
 *
 * 由 MainConfiguration.onReady 调用（对应 NestJS onApplicationBootstrap），并保证早于 scheduler 初始轮。
 * NestJS 版用 SEEDERS 令牌聚合数组；Midway 下直接注入三个 Seeder（无 multi-provider 工厂）。
 */
export class SeedRunner {
  constructor(
    private readonly sourcesSeeder: SourcesSeeder,
    private readonly superAdminSeeder: SuperAdminSeeder,
    private readonly runtimeSettingsSeeder: RuntimeSettingsSeeder,
  ) {}

  async run(now: number): Promise<void> {
    const ctx: SeedContext = { now };
    const seeders: readonly Seeder[] = [
      this.sourcesSeeder,
      this.superAdminSeeder,
      this.runtimeSettingsSeeder,
    ];
    const ordered = [...seeders].sort((a, b) => a.order - b.order);
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
