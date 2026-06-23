import { Injectable } from '@nestjs/common';
import { logger } from '@/logger';
import { BlueprintsSeeder } from './blueprints.seeder';
import { ProcessesSeeder } from './processes.seeder';
import { RuntimeSettingsSeeder } from './runtime-settings.seeder';
import type { Seeder, SeedContext } from './seeder';
import { SourcesSeeder } from './sources.seeder';
import { SuperAdminSeeder } from './super-admin.seeder';

/**
 * 种子编排器：启动时按 order 串行驱动全部 Seeder（唯一入口）。
 * - 统一时间（一次 nowSec 下传）、统一日志、统一失败语义
 * - critical 失败 → 向上抛中止启动；non-critical 失败 → warn 后继续
 *
 * 由 app 侧启动钩子调用（NestJS：onApplicationBootstrap），并保证早于 scheduler 初始轮。
 * 直接构造注入三个 Seeder（不走 Angular 式 multi-provider 工厂 / SEEDERS 令牌）。
 */
@Injectable()
export class SeedRunner {
  constructor(
    private readonly sourcesSeeder: SourcesSeeder,
    private readonly superAdminSeeder: SuperAdminSeeder,
    private readonly runtimeSettingsSeeder: RuntimeSettingsSeeder,
    private readonly blueprintsSeeder: BlueprintsSeeder,
    private readonly processesSeeder: ProcessesSeeder,
  ) {}

  async run(now: number): Promise<void> {
    const ctx: SeedContext = { now };
    const seeders: readonly Seeder[] = [
      this.sourcesSeeder,
      this.superAdminSeeder,
      this.runtimeSettingsSeeder,
      this.blueprintsSeeder,
      this.processesSeeder,
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
