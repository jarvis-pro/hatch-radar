import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { nowSec, SeedRunner } from '@hatch-radar/core';

/**
 * Nest 侧种子薄封装：启动时（onApplicationBootstrap，早于 scheduler 初始轮）跑 core 的 SeedRunner。
 * 编排与各 Seeder 逻辑都在 @hatch-radar/core。
 */
@Injectable()
export class SeedHook implements OnApplicationBootstrap {
  constructor(private readonly seedRunner: SeedRunner) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.seedRunner.run(nowSec());
  }
}
