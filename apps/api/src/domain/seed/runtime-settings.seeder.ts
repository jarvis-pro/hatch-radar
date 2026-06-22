import { Injectable } from '@nestjs/common';
import { RuntimeSettingsService } from '../settings/runtime-settings.service';
import type { Seeder, SeedOutcome } from './seeder';

/**
 * 运行期参数默认值（幂等）：app_settings 中缺失的项补播出厂默认，已存在的不动。
 * non-critical：读取侧本就回落同一默认常量。实际写入委托 RuntimeSettingsService.ensureSeeded。
 */
@Injectable()
export class RuntimeSettingsSeeder implements Seeder {
  readonly name = 'runtime-settings';
  readonly order = 30;
  readonly critical = false;

  constructor(private readonly runtimeSettings: RuntimeSettingsService) {}

  async run(): Promise<SeedOutcome> {
    const inserted = await this.runtimeSettings.ensureSeeded();
    return inserted > 0
      ? { status: 'seeded', detail: `写入 ${inserted} 项默认值（app_settings）` }
      : { status: 'skipped', reason: '运行期参数默认值已存在' };
  }
}
