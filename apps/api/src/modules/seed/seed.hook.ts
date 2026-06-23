import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { nowSec } from '@/utils/time';
import { SeedRunner } from './seed.runner';

/**
 * Nest 侧种子薄封装：启动时（onApplicationBootstrap，早于 scheduler 初始轮）跑 SeedRunner。
 * 编排器 SeedRunner 与各 Seeder 同在 modules/seed。
 */
@Injectable()
export class SeedHook implements OnApplicationBootstrap {
  constructor(
    // 种子编排器：启动时按 order 串行驱动全部 Seeder
    private readonly seedRunner: SeedRunner,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.seedRunner.run(nowSec());
  }
}
